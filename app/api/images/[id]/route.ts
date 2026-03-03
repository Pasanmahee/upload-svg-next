/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage } from '@/lib/gcs';
import { verifyFirebaseAuth } from '@/lib/auth';
import { optimiseRaster } from '@/lib/imageOptimiser';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

type GcsRef = { bucket: string; objectPath: string };

function setCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PATCH, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key',
    'Cache-Control': 'no-store',
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

function isDataUrl(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith('data:');
}

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>[?query]
 *  - gs://<bucket>/<object>
 *  - <objectPath> (assumes default bucket)
 */
function parseGcsObjectRef(value: unknown): GcsRef | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('data:')) return null;

  const noQuery = value.split('?')[0];

  if (noQuery.startsWith('gs://')) {
    const rest = noQuery.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const httpsPrefix = 'https://storage.googleapis.com/';
  if (noQuery.startsWith(httpsPrefix)) {
    const rest = noQuery.slice(httpsPrefix.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const objectPath = noQuery.replace(/^\/+/, '');
  if (!objectPath) return null;
  return { bucket: getBucketName(), objectPath };
}

async function signReadUrl(maybeUrlOrPath: unknown): Promise<unknown> {
  const ref = parseGcsObjectRef(maybeUrlOrPath);
  if (!ref) return maybeUrlOrPath;

  try {
    const storage = getStorage();
    const [signedUrl] = await storage
      .bucket(ref.bucket)
      .file(ref.objectPath)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
    return signedUrl;
  } catch {
    return maybeUrlOrPath;
  }
}

async function deleteIfPresent(maybeUrlOrPath: unknown): Promise<void> {
  const ref = parseGcsObjectRef(maybeUrlOrPath);
  if (!ref) return;

  try {
    const storage = getStorage();
    await storage.bucket(ref.bucket).file(ref.objectPath).delete({ ignoreNotFound: true });
  } catch {
    // best-effort
  }
}

function isHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s);
}

function parseColorsFromAny(value: unknown): string[] {
  const clamp = (arr: string[]) => Array.from(new Set(arr)).slice(0, 64);

  if (Array.isArray(value)) {
    const out = value
      .map((c) => String(c).trim())
      .filter((c) => isHexColor(c))
      .map((c) => c.toUpperCase());
    return clamp(out);
  }

  if (typeof value !== 'string') return [];
  const s = value.trim();
  if (!s) return [];

  // JSON array
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parseColorsFromAny(parsed);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).palette)) {
      return parseColorsFromAny((parsed as any).palette);
    }
  } catch {
    // fallthrough
  }

  // comma/newline separated
  const out = s
    .split(/[\n,]/g)
    .map((c) => c.trim())
    .filter((c) => isHexColor(c))
    .map((c) => c.toUpperCase());
  return clamp(out);
}

function isSafeIdLike(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && !/[.$\s]/.test(s);
}

function parseCategoriesFromAny(value: unknown): string[] {
  let arr: any[] = [];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) arr = parsed;
      else return [];
    } catch {
      // comma separated fallback
      arr = s.split(',');
    }
  } else return [];

  return Array.from(
    new Set(arr.map((x) => String(x).trim()).filter((x) => isSafeIdLike(x)))
  ).slice(0, 20);
}

function toBool(v: unknown): boolean {
  const s = String(v ?? '').toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

function safeBaseName(fileName: string): string {
  const base = String(fileName || 'upload').split(/[/\\]/).pop() || 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function buildThumbnailSvg(svgString: string, strokeColor = '#000000') {
  let s = svgString || '';
  if (!/<svg\b/i.test(s)) {
    s = `<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
  }

  const styleBlock = `\n<style><![CDATA[\n  path, polygon, polyline, rect, circle, ellipse, line {\n    fill: none !important;\n    stroke: ${strokeColor} !important;\n  }\n  g.label, text { display: none !important; }\n]]></style>`;

  if (/<svg\b[^>]*>/i.test(s)) {
    s = s.replace(/<svg\b([^>]*)>/i, (m, attrs) => `<svg${attrs}>${styleBlock}`);
  } else {
    s = `<svg xmlns="http://www.w3.org/2000/svg">${styleBlock}${s}</svg>`;
  }

  return s;
}

function applyStrokeFillRules(originalSvg: string, strokeColor: string): string {
  return (originalSvg || '')
    .replace(/fill\s*=\s*['"][^'"]*['"]/gi, 'fill="#FFFFFF"')
    .replace(/fill\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi, 'fill:#FFFFFF;')
    .replace(/stroke\s*=\s*['"][^'"]*['"]/gi, `stroke="${strokeColor}"`)
    .replace(/stroke\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi, `stroke:${strokeColor};`);
}

function assertAdminOrOwner(request: Request, doc: any, authUid: string | null): { ok: true } | { ok: false; status: number; error: string } {
  if (doc?.userId && typeof doc.userId === 'string') {
    if (!authUid) return { ok: false, status: 401, error: 'Unauthorized' };
    if (authUid !== doc.userId) return { ok: false, status: 403, error: 'Forbidden' };
    return { ok: true };
  }

  const adminKey = process.env.ADMIN_EDIT_KEY || process.env.ADMIN_DELETE_KEY || '';
  const provided = request.headers.get('x-admin-key') || '';
  if (!adminKey || provided !== adminKey) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true };
}

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request, ctx: { params: { id: string } }) {
  const headers = setCORSHeaders();
  const id = ctx?.params?.id;

  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400, headers });
  }

  try {
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    const doc = await collection.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    }

    // Private records require ownership
    if (doc?.userId && typeof doc.userId === 'string') {
      if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
      if (uid !== doc.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
    }

    const pngData = await signReadUrl((doc as any).pngData);
    const svgData = await signReadUrl((doc as any).svgData);

    return NextResponse.json(
      {
        ...doc,
        _id: doc._id.toString(),
        pngData,
        svgData,
      },
      { headers }
    );
  } catch (err: unknown) {
    console.error('images/[id] GET error:', err);
    return NextResponse.json({ error: 'Failed to load image', details: getErrorMessage(err) }, { status: 500, headers });
  }
}

/**
 * PATCH /api/images/:id
 * Body: { colors?: string[]|string, categories?: string[]|string, hasSimplifiedSvg?: boolean }
 */
export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  const headers = setCORSHeaders();
  const id = ctx?.params?.id;

  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400, headers });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    const doc = await collection.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    }

    const access = assertAdminOrOwner(request, doc, uid);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status, headers });
    }

    const colors = body?.colors !== undefined ? parseColorsFromAny(body.colors) : undefined;
    const categories = body?.categories !== undefined ? parseCategoriesFromAny(body.categories) : undefined;
    const hasSimplifiedSvg = body?.hasSimplifiedSvg !== undefined ? Boolean(body.hasSimplifiedSvg) : undefined;

    const update: any = { updatedAt: new Date() };
    if (colors !== undefined) update.colors = colors;
    if (categories !== undefined) update.categories = categories;
    if (hasSimplifiedSvg !== undefined) update.hasSimplifiedSvg = hasSimplifiedSvg;

    await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });

    const updated = await collection.findOne({ _id: new ObjectId(id) });

    return NextResponse.json(
      {
        ok: true,
        record: {
          ...(updated as any),
          _id: (updated as any)?._id?.toString?.() ?? id,
        },
      },
      { headers }
    );
  } catch (err: unknown) {
    console.error('images/[id] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update image', details: getErrorMessage(err) }, { status: 500, headers });
  }
}

/**
 * PUT /api/images/:id
 * multipart/form-data
 * - svgFile?: File
 * - imageFile?: File
 * - colors?: JSON string | comma/newline string | string[]
 * - categories?: JSON string | string[]
 * - hasSimplifiedSvg?: boolean
 */
export async function PUT(request: Request, ctx: { params: { id: string } }) {
  const headers = setCORSHeaders();
  const id = ctx?.params?.id;

  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400, headers });
  }

  try {
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    const doc = await collection.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    }

    const access = assertAdminOrOwner(request, doc, uid);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status, headers });
    }

    const form = await request.formData();
    const svgFile = form.get('svgFile');
    const imageFile = form.get('imageFile');

    const colorsIncoming = form.get('colors');
    const categoriesIncoming = form.get('categories');
    const hasSimplifiedIncoming = form.get('hasSimplifiedSvg');

    const newColors = colorsIncoming !== null ? parseColorsFromAny(colorsIncoming) : (Array.isArray((doc as any).colors) ? (doc as any).colors : []);
    const newCategories = categoriesIncoming !== null ? parseCategoriesFromAny(categoriesIncoming) : (Array.isArray((doc as any).categories) ? (doc as any).categories : []);
    const newHasSimplified = hasSimplifiedIncoming !== null ? toBool(hasSimplifiedIncoming) : Boolean((doc as any).hasSimplifiedSvg);

    const strokeColor = newColors?.[0] || '#000000';

    const hasSvgReplacement = svgFile instanceof File;
    const hasImageReplacement = imageFile instanceof File;

    if (!hasSvgReplacement && !hasImageReplacement) {
      return NextResponse.json(
        { error: 'No files provided. Use PATCH to update details only.' },
        { status: 400, headers }
      );
    }

    // --- SVG handling ---
    let svgDataStored: string = (doc as any).svgData || '';
    let modifiedSvgDataText: string | null = null;

    if (hasSvgReplacement) {
      const originalSvgText = await (svgFile as File).text();
      modifiedSvgDataText = applyStrokeFillRules(originalSvgText, strokeColor);
    }

    // --- Preview image handling (always WebP) ---
    let webpBuffer: Buffer | null = null;
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    if (hasImageReplacement) {
      const f = imageFile as File;
      const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
      if (!allowed.has(String(f.type || ''))) {
        return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 400, headers });
      }
      if (Number.isFinite(f.size) && f.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'Preview image is too large (max 10MB).' }, { status: 400, headers });
      }

      const ab = await f.arrayBuffer();
      const raw = Buffer.from(ab);

      // Force a small downscale before optimisation for consistent file size.
      const meta = await sharp(raw).metadata();
      const w = meta.width || 1024;
      const h = meta.height || 1024;
      const reducedW = Math.max(1, Math.floor(w * 0.9));
      const reducedH = Math.max(1, Math.floor(h * 0.9));

      const raster = await optimiseRaster(raw, {
        maxDim: Math.max(reducedW, reducedH),
        background: '#ffffff',
      });
      webpBuffer = raster.buffer;
    } else if (modifiedSvgDataText) {
      // No explicit image; generate outline-only thumbnail from the new SVG
      const thumbSvg = buildThumbnailSvg(modifiedSvgDataText, strokeColor);
      const thumbBuf = Buffer.from(thumbSvg, 'utf8');

      const meta = await sharp(thumbBuf).metadata();
      const w = meta.width || 1024;
      const h = meta.height || 1024;
      const reducedW = Math.max(1, Math.floor(w * 0.9));
      const reducedH = Math.max(1, Math.floor(h * 0.9));

      const raster = await optimiseRaster(thumbBuf, {
        maxDim: Math.max(reducedW, reducedH),
        maxColors: 16,
        minColors: 2,
        background: '#ffffff',
      });
      webpBuffer = raster.buffer;
    }

    // If only SVG replaced and preview generation failed for some reason, keep old pngData.
    let pngDataStored: string = (doc as any).pngData || '';

    // --- Upload to GCS if available; else store as data URLs ---
    const bucketName = getBucketName();
    const storage = getStorage();

    const ts = Date.now();
    const idShort = id.slice(-8);
    const svgName = safeBaseName((svgFile instanceof File ? svgFile.name : `svg-${idShort}.svg`));
    const imgName = safeBaseName((imageFile instanceof File ? imageFile.name : `img-${idShort}.webp`));

    const svgObjectPath = `svgs/${id}-${ts}-${svgName}.svg`;
    const pngObjectPath = `images/${id}-${ts}-${imgName}.webp`;

    // Best-effort cleanup (only when replacing a file)
    if (hasSvgReplacement) await deleteIfPresent((doc as any).svgData);
    if (hasImageReplacement || webpBuffer) await deleteIfPresent((doc as any).pngData);

    try {
      const bucket = storage.bucket(bucketName);

      if (hasSvgReplacement && modifiedSvgDataText) {
        const svgBuffer = Buffer.from(modifiedSvgDataText, 'utf8');
        await bucket.file(svgObjectPath).save(svgBuffer, {
          resumable: false,
          metadata: { contentType: 'image/svg+xml' },
        });
        svgDataStored = `https://storage.googleapis.com/${bucketName}/${svgObjectPath}`;
      }

      if (webpBuffer) {
        await bucket.file(pngObjectPath).save(webpBuffer, {
          resumable: false,
          metadata: { contentType: 'image/webp' },
        });
        pngDataStored = `https://storage.googleapis.com/${bucketName}/${pngObjectPath}`;
      }
    } catch {
      // fallback to data URLs (works even without GCS)
      if (hasSvgReplacement && modifiedSvgDataText) {
        const svgBuffer = Buffer.from(modifiedSvgDataText, 'utf8');
        svgDataStored = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
      }
      if (webpBuffer) {
        pngDataStored = `data:image/webp;base64,${webpBuffer.toString('base64')}`;
      }
    }

    const update: any = {
      updatedAt: new Date(),
      colors: newColors,
      categories: newCategories,
      hasSimplifiedSvg: newHasSimplified,
    };

    if (hasSvgReplacement) update.svgData = svgDataStored;
    if (hasImageReplacement || webpBuffer) update.pngData = pngDataStored;

    await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });

    const updated = await collection.findOne({ _id: new ObjectId(id) });

    const pngSigned = await signReadUrl((updated as any)?.pngData);
    const svgSigned = await signReadUrl((updated as any)?.svgData);

    return NextResponse.json(
      {
        ok: true,
        record: {
          ...(updated as any),
          _id: (updated as any)?._id?.toString?.() ?? id,
          pngData: pngSigned,
          svgData: svgSigned,
        },
      },
      { headers }
    );
  } catch (err: unknown) {
    console.error('images/[id] PUT error:', err);
    return NextResponse.json({ error: 'Failed to replace image', details: getErrorMessage(err) }, { status: 500, headers });
  }
}
