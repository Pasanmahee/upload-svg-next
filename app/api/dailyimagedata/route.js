import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
const client = new MongoClient(uri);

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Dedicated OPTIONS handler for CORS preflight
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(req) {
  const headers = setCORSHeaders();

  // Handle CORS preflight if needed
  if (req.method === 'OPTIONS') {
    return NextResponse.json({}, { status: 200, headers });
  }

  try {
    // 1. Parse query parameters
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const skip = (page - 1) * limit;

    // 2. Handle deviceRam parameter
    const deviceRamParam = searchParams.get('deviceRam');
    let deviceRam = 2; // Default if missing or 'unknown'
    if (deviceRamParam && deviceRamParam.toLowerCase() !== 'unknown') {
      deviceRam = parseFloat(deviceRamParam);
    }

    // 3. Decide if we’re dealing with low-complexity (RAM < 4)
    const threshold = 4;
    const isLowComplexity = deviceRam < threshold; // true if RAM < 4

    // 4. Connect to MongoDB
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // 5. Build the query (match stage for the pipeline)
    const matchStage = {
      userId: { $exists: false },
      hasSimplifiedSvg: isLowComplexity,
    };

    /**
     * 6. Build two pipelines:
     *    - pipelineData: actually fetch documents, grouped by day
     *    - pipelineCount: count total distinct days
     */

    // Pipeline to fetch data for the current page
    const pipelineData = [
      { $match: matchStage },
      { $sort: { date: -1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          // By sorting above, $first will be the most recent doc for that day
          doc: { $first: '$$ROOT' },
        },
      },
      // After grouping, we want to project a "flat" document structure
      {
        $project: {
          _id: '$doc._id',
          pngData: '$doc.pngData',
          date: '$doc.date',
        },
      },
      // We grouped by day which breaks the original sort order,
      // so we must sort again by date descending
      { $sort: { date: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    // Pipeline to get the total number of distinct days
    const pipelineCount = [
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        },
      },
      {
        $count: 'count',
      },
    ];

    // Execute pipelines
    const [data, totalResult] = await Promise.all([
      collection.aggregate(pipelineData).toArray(),
      collection.aggregate(pipelineCount).toArray(),
    ]);

    // Extract total count of distinct days
    const total = totalResult?.[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);

    // 7. Return the response
    const response = {
      data,
      page,
      totalPages,
      total,
    };

    return NextResponse.json(response, { headers });
  } finally {
    await client.close();
  }
}
