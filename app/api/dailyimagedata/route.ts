import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';

export const runtime = 'nodejs';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/dailyimagedata?page=1&limit=10&deviceRam=4
 *
 * NOTE:
 * - This route must not create DB clients at module scope. Vercel/Next build
 *   may evaluate the module during "Collecting page data", and missing env vars
 *   would crash the build.
 */
export async function GET(request: Request) {
  const headers = corsHeaders;

  try {
    const { searchParams } = new URL(request.url);

    // Pagination
    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = Number.parseInt(searchParams.get('limit') || '10', 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10;
    const skip = (page - 1) * limit;

    // Device RAM (optional)
    const deviceRamParam = searchParams.get('deviceRam');
    const deviceRam =
      deviceRamParam && deviceRamParam.toLowerCase() !== 'unknown'
        ? Number.parseFloat(deviceRamParam)
        : Number.NaN;

    // Only apply "simplified" filter if RAM is a valid number and below threshold.
    const threshold = 5;
    const hasValidRam = Number.isFinite(deviceRam);
    const isLowComplexity = hasValidRam && deviceRam < threshold;

    // Connect to MongoDB (via shared helper / cached client)
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    // Daily feed = documents that do NOT have userId (public feed)
    const query: Record<string, unknown> = {
      userId: { $exists: false },
    };

    // Prefer simplified SVGs on low-RAM devices if your docs are flagged accordingly
    if (isLowComplexity) query.hasSimplifiedSvg = true;

    const projection = {
      _id: 1,
      pngData: 1,
      date: 1,
      createdAt: 1,
      hasSimplifiedSvg: 1,
    };

    const data = await collection
      .find(query, { projection })
      .sort({ createdAt: -1, date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json(
      { data, page, totalPages, total },
      { headers }
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) },
      { status: 500, headers }
    );
  }
}