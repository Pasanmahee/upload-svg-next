import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

// In Route Handlers, use the Web Request API type:
export async function GET(req: Request) {
  const headers = setCORSHeaders();
  const { searchParams } = new URL(req.url);

  const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Number.parseInt(searchParams.get('limit') ?? '10', 10);
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

    const data = await collection
      .find(query, {
        projection: { _id: 1, userId: 1, pngData: 1, date: 1 },
      })
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({ data, page, totalPages, total }, { headers });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) || 'Failed to load data' },
      { status: 500, headers }
    );
  }
}
