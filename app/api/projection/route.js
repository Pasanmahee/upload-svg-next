// pages/api/svgdata/projection.js
import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
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

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // Query to retrieve only the _id and pngData fields
    const data = await collection.find({}, { projection: { _id: 1, pngData: 1 } }).toArray();

    return NextResponse.json(data, { headers });
  } finally {
    await client.close();
  }
}
