import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

export const runtime = 'nodejs';

const mongoUri = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI;
if (!mongoUri) throw new Error('Missing environment variable: MONGODB_URI');

// Virtual categories (do NOT store in DB)
const VIRTUAL_CATEGORY_ALL_ID = 'all';
const VIRTUAL_CATEGORY_NEW_ID = 'new';

const globalForMongo = globalThis;

let clientPromise;
if (process.env.NODE_ENV === 'development') {
  if (!globalForMongo._mongoClientPromise) {
    const client = new MongoClient(mongoUri);
    globalForMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalForMongo._mongoClientPromise;
} else {
  const client = new MongoClient(mongoUri);
  clientPromise = client.connect();
}

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function GET() {
  const headers = setCORSHeaders();

  try {
    const client = await clientPromise;
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('categories');

    const docs = await collection
      .find({}, { projection: { name: 1 } })
      .sort({ name: 1 })
      .toArray();

    // Convert to { _id: string, name: string } and remove any stored "New"/"All" to avoid duplicates
    const categories = docs
      .map((d) => ({ _id: d._id.toString(), name: d.name }))
      .filter((c) => {
        const n = String(c.name || '').trim().toLowerCase();
        return n !== 'new' && n !== 'all';
      });

    const withVirtual = [
      { _id: VIRTUAL_CATEGORY_ALL_ID, name: 'All' },
      { _id: VIRTUAL_CATEGORY_NEW_ID, name: 'New' },
      ...categories,
    ];

    return NextResponse.json({ categories: withVirtual }, { headers });
  } catch (err) {
    console.error('categories GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500, headers });
  }
}
