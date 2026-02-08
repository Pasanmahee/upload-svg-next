// app/api/your-route/route.js
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Separate handler for OPTIONS requests
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(req) {
  const headers = setCORSHeaders();
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const userId = searchParams.get('userId'); 
  const skip = (page - 1) * limit;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400, headers });
  }

  try {
    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('svgdata');

    const query = { userId };

    const data = await collection.find(query, {
      projection: {
        _id: 1,
        userId: 1,
        pngData: 1,
        date: 1
      },
    })
    .skip(skip)
    .limit(limit)
    .toArray();

    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    const response = {
      data,
      page,
      totalPages,
      total,
    };

    return NextResponse.json(response, { headers });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load data' }, { status: 500, headers });
  }
}
