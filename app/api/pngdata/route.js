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
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const categoryId = searchParams.get('categoryId');

  // Retrieve deviceRam from query parameters.
  // If missing or set to "unknown", default to a low value (e.g., 2).
  const deviceRamParam = searchParams.get('deviceRam');
  let deviceRam;
  if (!deviceRamParam || deviceRamParam.toLowerCase() === 'unknown') {
    deviceRam = 2;
  } else {
    deviceRam = parseFloat(deviceRamParam);
  }

  // Define a threshold; devices with less than 4GB are considered low-RAM.
  const threshold = 4;
  const isLowComplexity = deviceRam < threshold;

  const skip = (page - 1) * limit;

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // Build the base query.
    const query = {};
    if (categoryId) {
      query.categories = categoryId;
    }

    let projection;

    // For low-RAM devices: only return documents with hasSimplifiedSvg = true.
    if (isLowComplexity) {
      query.hasSimplifiedSvg = true;

      // Return only the fields you need.
      projection = {
        _id: 1,
        categories: 1,
        date: 1,
        pngData: 1, 
      };
    } else {
      // For high-RAM devices: only return documents with hasSimplifiedSvg = false.
      query.hasSimplifiedSvg = false;

      // Return the full fields you need.
      projection = {
        _id: 1,
        categories: 1,
        date: 1,
        pngData: 1,
      };
    }

    // Query the collection with pagination.
    const data = await collection
      .find(query, { projection })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Retrieve the total count of documents matching our query.
    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

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
