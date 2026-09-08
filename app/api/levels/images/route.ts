/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage, resolveGcsReadUrl } from '@/lib/gcs';
import { getLevelById, inferImageLevelId } from '@/lib/levelSystem';
import { getGameConfig, publicGameConfig } from '@/lib/gameConfig';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
const VIRTUAL_CATEGORY_ALL_ID = 'all';
const VIRTUAL_CATEGORY_NEW_ID = 'new';
const NEW_WINDOW_DAYS = Number.parseInt(process.env.NEW_WINDOW_DAYS || '30', 10) || 30;

type GcsRef = { bucket: string; objectPath: string };

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: headers() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

function parseGcsObjectRef(value: unknown): GcsRef | null {
  if (typeof value !== 'string' || !value || value.startsWith('data:')) return null;
  const noQuery = value.split('?')[0];
  if (noQuery.startsWith('gs://')) {
    const rest = noQuery.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    return { bucket: rest.slice(0, firstSlash), objectPath: rest.slice(firstSlash + 1) };
  }
  const httpsPrefix = 'https://storage.googleapis.com/';
  if (noQuery.startsWith(httpsPrefix)) {
    const rest = noQuery.slice(httpsPrefix.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    return { bucket: rest.slice(0, firstSlash), objectPath: rest.slice(firstSlash + 1) };
  }
  if (noQuery.includes('://')) return null;
  const objectPath = noQuery.replace(/^\/+/, '');
  return objectPath ? { bucket: getBucketName(), objectPath } : null;
}

async function signReadUrl(maybeUrlOrPath: unknown, origin: string): Promise<unknown> {
  return resolveGcsReadUrl(maybeUrlOrPath, origin, SIGNED_URL_TTL_MS);
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

function isNewByDate(doc: any): boolean {
  const raw = doc?.createdAt || doc?.date;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() <= NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
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
    // ignore category lookup failures; level fallback still works.
  }
  return map;
}

function matchesCategory(doc: any, categoryId: string | null): boolean {
  if (!categoryId || categoryId === VIRTUAL_CATEGORY_ALL_ID) return true;
  if (categoryId === VIRTUAL_CATEGORY_NEW_ID) return isNewByDate(doc);
  const cats = Array.isArray(doc?.categories) ? doc.categories : [];
  return cats.some((raw: any) => {
    const id = String(raw?._id ?? raw ?? '').trim();
    return id === categoryId || (ObjectId.isValid(categoryId) && id === new ObjectId(categoryId).toString());
  });
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const { searchParams } = requestUrl;
    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = Number.parseInt(searchParams.get('limit') || '12', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 12;
    const categoryIdRaw = searchParams.get('categoryId');
    const categoryId = categoryIdRaw ? categoryIdRaw.trim() : null;
    const deviceRamParam = searchParams.get('deviceRam');
    const deviceRam = deviceRamParam && deviceRamParam.toLowerCase() !== 'unknown' ? Number.parseFloat(deviceRamParam) : Number.NaN;
    const isLowComplexity = Number.isFinite(deviceRam) && deviceRam < 5;

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const rawConfig = await getGameConfig(db);
    const config = publicGameConfig(rawConfig, new URL(request.url).origin);
    const level = getLevelById(searchParams.get('levelId') || 'beginner', config.levels);
    const collection = db.collection('svgdata');
    const categoryNameById = await buildCategoryNameMap(db);

    const query: any = { userId: { $exists: false } };
    if (isLowComplexity) query.hasSimplifiedSvg = true;

    const docs = await collection
      .find(query, {
        projection: {
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
        },
      })
      .sort({ date: -1, createdAt: -1, _id: -1 })
      .limit(5000)
      .toArray();

    const assigned = docs
      .map((doc: any, index: number) => ({ doc, levelId: inferImageLevelId(doc, index, categoryNameById, config.levels) }))
      .filter((item: any) => item.levelId === level.id && matchesCategory(item.doc, categoryId));

    const total = assigned.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const pageItems = assigned.slice(start, start + limit);

    const data = await Promise.all(pageItems.map(async (item: any) => {
      const doc = item.doc;
      return {
        _id: doc._id?.toString?.() ?? String(doc._id ?? ''),
        pngData: await signReadUrl(doc.pngData, requestUrl.origin),
        categories: Array.isArray(doc.categories) ? doc.categories.map((x: any) => String(x?._id ?? x ?? '')) : [],
        colors: Array.isArray(doc.colors) ? doc.colors : [],
        levelId: item.levelId,
        title: typeof doc.title === 'string' ? doc.title : typeof doc.name === 'string' ? doc.name : null,
        date: toIso(doc.date || doc.createdAt),
        createdAt: toIso(doc.createdAt || doc.date),
        hasSimplifiedSvg: !!doc.hasSimplifiedSvg,
      };
    }));

    return json({
      data,
      page,
      totalPages,
      total,
      level,
      levels: config.levels,
    });
  } catch (e: any) {
    return json({ error: 'Failed to load level images', details: e?.message || String(e) }, 500);
  }
}
