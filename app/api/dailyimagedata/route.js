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

    // 5. Build the query:
    //    - Exclude documents with userId (so userId does NOT exist).
    //    - Return only hasSimplifiedSvg = true for low-RAM,
    //      and hasSimplifiedSvg = false for high-RAM devices.
    const query = {
      userId: { $exists: false },
      hasSimplifiedSvg: isLowComplexity,
    };

    // 6. Projection: fields you want to return
    const projection = {
      _id: 1,
      pngData: 1,
      date: 1,
    };

    // 7. Retrieve data with sorting, pagination, projection
    const data = await collection
      .find(query, { projection })
      .skip(skip)
      .limit(limit)
      .toArray();

    // 8. Count total matching documents for pagination
    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    // 9. Return the response
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
