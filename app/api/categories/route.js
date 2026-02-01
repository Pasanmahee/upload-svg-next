import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

export const runtime = 'nodejs';

// Prefer server-only env var; keep NEXT_PUBLIC_ only as a temporary fallback.
const uri = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI;
if (!uri) throw new Error('Missing environment variable: MONGODB_URI');

const g = globalThis;
let clientPromise;

if (process.env.NODE_ENV === 'development') {
  if (!g._mongoClientPromise) {
    g._mongoClientPromise = new MongoClient(uri).connect();
  }
  clientPromise = g._mongoClientPromise;
} else {
  clientPromise = new MongoClient(uri).connect();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Route Handlers support OPTIONS for CORS preflight (Next.js, 2025). :contentReference[oaicite:2]{index=2}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const headers = corsHeaders();

  try {
    const client = await clientPromise;
    const db = client.db('svgfacetpaintbynumber');

    const categories = await db
      .collection('categories')
      .find({}, { projection: { _id: 1, name: 1 } })
      .toArray();

    return NextResponse.json({ categories }, { headers });
  } catch (err) {
    console.error('GET /api/categories failed:', err);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500, headers });
  }
}
