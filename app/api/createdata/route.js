import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
const client = new MongoClient(uri);

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function GET(req) {
  const headers = setCORSHeaders();

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return NextResponse.json({}, { status: 200, headers });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const userId = searchParams.get('userId');  // Retrieve userId from query parameters
  const skip = (page - 1) * limit;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400, headers });
  }

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // Simplify the query to match documents where userId equals the provided userId
    const query = { userId };

    // Query to retrieve only the relevant fields with pagination
    const data = await collection.find(query, {
      projection: {
        _id: 1,
        userId,
        pngData: 1,
        date: 1,
      },
    })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Retrieve the total count of documents that match the query for pagination metadata
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
