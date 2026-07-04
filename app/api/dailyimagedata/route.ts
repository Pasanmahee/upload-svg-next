import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { signGcsReadUrl } from '@/lib/gcs';
import { getGameConfig, publicGameConfig } from '@/lib/gameConfig';
import { inferImageLevelId } from '@/lib/levelSystem';

export const runtime = 'nodejs';

// -----------------------------
// Google Cloud Storage signing
// -----------------------------
// Uses the shared lazy GCS helper so this route no longer crashes at module
// load when GCS credentials are supplied through GOOGLE_APPLICATION_CREDENTIALS
// or Application Default Credentials instead of GCP_SA_KEY_B64.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
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

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  try {
    if (typeof v?.toISOString === 'function') return v.toISOString();
  } catch {
    // ignore
  }
  return String(v);
}

async function buildCategoryNameMap(db: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const cats = await db.collection('categories').find({}, { projection: { name: 1 } }).toArray();
    for (const c of cats) {
      const id = c?._id?.toString?.() ?? String(c?._id ?? '');
      if (id) map.set(id, String(c?.name || '').toLowerCase());
    }
  } catch {
    // ignore; level fallback still works.
  }
  return map;
}

function parseUnlockedLevelIds(raw: string | null): Set<string> {
  return new Set(
    String(raw || '')
      .split(',')
      .map((x) => x.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
      .filter(Boolean),
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/dailyimagedata?page=1&limit=10&deviceRam=4&unlockedLevelIds=beginner,easy-animals
 *
 * Daily Images must respect level locks. When unlockedLevelIds is supplied by the app,
 * this route filters before pagination so locked Expert/other level images do not appear
 * on /daily-images.
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
    const unlockedLevelIds = parseUnlockedLevelIds(searchParams.get('unlockedLevelIds'));

    // Connect to MongoDB (via shared helper / cached client)
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');
    const rawConfig = await getGameConfig(db);
    const config = publicGameConfig(rawConfig, new URL(request.url).origin);
    const categoryNameById = await buildCategoryNameMap(db);

    // Daily feed = documents that do NOT have userId (public feed)
    const baseQuery: Record<string, unknown> = {
      userId: { $exists: false },
    };

    const projection = {
      _id: 1,
      pngData: 1,
      categories: 1,
      colors: 1,
      date: 1,
      createdAt: 1,
      updatedAt: 1,
      hasSimplifiedSvg: 1,
      levelId: 1,
      title: 1,
      name: 1,
    };

    async function mapDoc(doc: any, index: number) {
      let pngData = doc.pngData;
      if (typeof pngData === 'string') {
        try {
          pngData = await signGcsReadUrl(pngData);
        } catch {
          // If signing fails for any reason, fall back to original value
        }
      }

      const levelId = inferImageLevelId(doc, index, categoryNameById, config.levels);
      return {
        _id: doc._id?.toString?.() ?? String(doc._id ?? ''),
        pngData,
        categories: Array.isArray(doc.categories) ? doc.categories.map((x: any) => String(x?._id ?? x ?? '')) : [],
        colors: Array.isArray(doc.colors) ? doc.colors : [],
        levelId,
        title: typeof doc.title === 'string' ? doc.title : typeof doc.name === 'string' ? doc.name : null,
        date: toIso(doc.date || doc.createdAt),
        createdAt: toIso(doc.createdAt || doc.date),
        hasSimplifiedSvg: !!doc.hasSimplifiedSvg,
      };
    }

    async function fetchFilteredPage(query: Record<string, unknown>) {
      const docs = await collection
        .find(query, { projection })
        .sort({ date: -1, createdAt: -1, _id: -1 })
        .limit(5000)
        .toArray();

      const assigned = docs
        .map((doc: any, index: number) => ({ doc, levelId: inferImageLevelId(doc, index, categoryNameById, config.levels) }))
        .filter((item: any) => unlockedLevelIds.size === 0 || unlockedLevelIds.has(item.levelId));

      const total = assigned.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const start = (page - 1) * limit;
      const pageItems = assigned.slice(start, start + limit);
      const data = await Promise.all(pageItems.map((item: any, localIndex: number) => mapDoc(item.doc, start + localIndex)));
      return { data, total, totalPages };
    }

    async function fetchPlainPage(query: Record<string, unknown>) {
      const total = await collection.countDocuments(query);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const dataDocs = await collection
        .find(query, { projection })
        .sort({ date: -1, createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();

      const data = await Promise.all(dataDocs.map((doc: any, index: number) => mapDoc(doc, (page - 1) * limit + index)));
      return { data, total, totalPages };
    }

    let query: Record<string, unknown> = { ...baseQuery };
    if (isLowComplexity) query.hasSimplifiedSvg = true;

    const useLevelLockFilter = unlockedLevelIds.size > 0;
    let result = useLevelLockFilter ? await fetchFilteredPage(query) : await fetchPlainPage(query);

    if (isLowComplexity && result.total === 0) {
      query = { ...baseQuery };
      result = useLevelLockFilter ? await fetchFilteredPage(query) : await fetchPlainPage(query);
    }

    return NextResponse.json(
      { data: result.data, page, totalPages: result.totalPages, total: result.total },
      { headers },
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) },
      { status: 500, headers },
    );
  }
}
