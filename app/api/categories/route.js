// app/api/categories/route.js (Next.js 13+)

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

/** 
 * For Next.js App Router: 
 * If you want fresh data on every request and avoid static caching, 
 * you can export `dynamic = 'force-dynamic'` 
 */
export const dynamic = 'force-dynamic';  // optional; see note above

// Cache variables to prevent multiple connections in serverless
let cachedClient = null;
let cachedDb = null;

// Helper to connect to MongoDB with caching
async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db('svgfacetpaintbynumber');

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Handle the GET request
export async function GET(req) {
  const headers = setCORSHeaders();

  // If this is a preflight request (CORS), return early
  if (req.method === 'OPTIONS') {
    return NextResponse.json({}, { status: 200, headers });
  }

  try {
    // Connect to the DB
    const { db } = await connectToDatabase();
    const categoriesCollection = db.collection('categories');

    // Get all categories
    const categories = await categoriesCollection.find({}).toArray();

    // Return categories in JSON
    return NextResponse.json({ categories }, { headers });
  } catch (err) {
    return NextResponse.json(
      {
        message: 'Error fetching categories',
        error: err.message,
      },
      { status: 500, headers }
    );
  }
}
