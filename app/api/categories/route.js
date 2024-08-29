import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
let client;
let clientPromise;

if (!client) {
  client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  clientPromise = client.connect();
}

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

  try {
    await clientPromise;
    const database = client.db('svgfacetpaintbynumber');
    const categoriesCollection = database.collection('categories');

    // Fetch all categories
    const categories = await categoriesCollection.find({}).toArray();

    return NextResponse.json({ categories }, { status: 200, headers });
  } catch (err) {
    return NextResponse.json({ message: 'Error fetching categories', error: err.message }, { status: 500, headers });
  }
}
