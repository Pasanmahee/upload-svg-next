/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';

export const runtime = 'nodejs';

// Virtual categories (do NOT store in DB)
const VIRTUAL_CATEGORY_ALL_ID = 'all';
const VIRTUAL_CATEGORY_NEW_ID = 'new';

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function GET() {
  const headers = setCORSHeaders();

  try {
    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('categories');

    const docs = await collection
      .find({}, { projection: { name: 1 } })
      .sort({ name: 1 })
      .toArray();

    // Convert to { _id: string, name: string } and remove any stored "New"/"All" to avoid duplicates
    const categories = (docs || [])
      .map((d: any) => ({ _id: d._id.toString(), name: d.name }))
      .filter((c: any) => {
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

export async function POST(request: Request) {
  const headers = setCORSHeaders();

  try {
    const body = (await request.json()) as { name?: unknown };
    const rawName = String(body?.name ?? '').trim();

    if (!rawName) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400, headers });
    }

    // Prevent storing virtual categories
    const lowered = rawName.toLowerCase();
    if (lowered === 'all' || lowered === 'new') {
      return NextResponse.json({ error: 'This category name is reserved' }, { status: 400, headers });
    }

    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('categories');

    const existing = await collection.findOne(
      { name: { $regex: `^${escapeRegExp(rawName)}$`, $options: 'i' } },
      { projection: { name: 1 } }
    );

    if (existing) {
      return NextResponse.json(
        { created: false, category: { _id: existing._id.toString(), name: existing.name } },
        { headers }
      );
    }

    const ins = await collection.insertOne({ name: rawName });

    return NextResponse.json(
      { created: true, category: { _id: ins.insertedId.toString(), name: rawName } },
      { status: 201, headers }
    );
  } catch (err) {
    console.error('categories POST error:', err);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500, headers });
  }
}
