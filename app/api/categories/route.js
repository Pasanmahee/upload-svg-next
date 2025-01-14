import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
const client = new MongoClient(uri);

// Helper to set CORS headers
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

// GET handler to fetch categories
export async function GET(req) {
  const headers = setCORSHeaders();

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('categories');

    // Retrieve all categories; adjust projection if you only want specific fields
    const categories = await collection.find({}, {
      projection: {
        _id: 1,
        name: 1
      }
    }).toArray();

    // You can wrap the categories in an object for consistency
    // e.g. { data: categories }
    return NextResponse.json({ categories: categories }, { headers });
  } finally {
    // Close DB connection
    await client.close();
  }
}
