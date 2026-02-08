import { logger } from '@/lib/logger';
import { getMongoClient, getDbName } from '@/lib/mongo';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export async function GET() {
  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const categories = await db.collection('categories').find({}).sort({ name: 1 }).toArray();
    return json({ categories });
  } catch (error: any) {
    logger.error('Error fetching categories', { error: error?.message || error });
    return json({ error: 'Failed to fetch categories' }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const name = (body?.name || '').toString().trim();
    if (!name) return json({ error: 'Missing category name' }, 400);

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const col = db.collection('categories');

    const existing = await col.findOne({ name });
    if (existing) return json({ category: existing, created: false });

    const insertRes = await col.insertOne({ name, createdAt: new Date() });
    const category = await col.findOne({ _id: insertRes.insertedId });
    return json({ category, created: true }, 201);
  } catch (error: any) {
    logger.error('Error creating category', { error: error?.message || error });
    return json({ error: 'Failed to create category' }, 500);
  }
}
