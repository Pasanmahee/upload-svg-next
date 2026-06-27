import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { getUidIfPresent } from "@/lib/auth";
import { optimiseRaster } from '@/lib/imageOptimiser';
import { getGameConfig } from '@/lib/gameConfig';
import { isValidLevelId } from '@/lib/levelSystem';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ---------- GCS helpers (lazy, no module-scope throw) ----------
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

function getBucketName(): string | null {
  return process.env.GCS_BUCKET || process.env.GCS_BUCKET_NAME || null;
}

function getServiceAccountJson(): any | null {
  const b64 = process.env.GCP_SA_KEY_B64 || null;
  if (!b64) return null;
  try {
    const raw = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  const creds = getServiceAccountJson();
  if (!creds) return null;
  return new Storage({
    projectId: creds.project_id,
    credentials: creds,
  });
}

function parseGcsObjectRef(value: string) {
  if (!value || typeof value !== 'string') return null;

  // gs://bucket/path
  if (value.startsWith('gs://')) {
    const rest = value.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash <= 0) return null;
    return { bucket: rest.slice(0, firstSlash), objectPath: rest.slice(firstSlash + 1) };
  }

  // https://storage.googleapis.com/bucket/path
  const m1 = value.match(/^https?:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/i);
  if (m1) return { bucket: m1[1], objectPath: m1[2] };

  // https://<bucket>.storage.googleapis.com/path
  const m2 = value.match(/^https?:\/\/([^./]+)\.storage\.googleapis\.com\/(.+)$/i);
  if (m2) return { bucket: m2[1], objectPath: m2[2] };

  return null;
}

async function signReadUrl(maybeUrlOrPath: string): Promise<string> {
  const storage = getStorage();
  const target = parseGcsObjectRef(maybeUrlOrPath);
  if (!storage || !target) return maybeUrlOrPath;

  const [signedUrl] = await storage
    .bucket(target.bucket)
    .file(target.objectPath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });

  return signedUrl;
}

function isDataUrl(s: string) {
  return typeof s === 'string' && s.startsWith('data:');
}

function decodeSvgDataUrlToText(dataUrl: string): string | null {
  // data:image/svg+xml;base64,....
  const m = dataUrl.match(/^data:image\/svg\+xml;base64,(.+)$/i);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// ---------- Thumbnail SVG sanitizer (outline-only, hide numbers) ----------
function buildThumbnailSvg(svgString: string, strokeColor = '#000000') {
  let s = svgString || '';

  // ensure it’s a full svg
  if (!/<svg\b/i.test(s)) {
    s = `<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
  }

  const styleBlock = `
<style><![CDATA[
  path, polygon, polyline, rect, circle, ellipse, line {
    fill: none !important;
    stroke: ${strokeColor} !important;
  }
  g.label, text { display: none !important; }
]]></style>`;

  if (/<svg\b[^>]*>/i.test(s)) {
    s = s.replace(/<svg\b([^>]*)>/i, (m, attrs) => `<svg${attrs}>${styleBlock}`);
  } else {
    s = `<svg xmlns="http://www.w3.org/2000/svg">${styleBlock}${s}</svg>`;
  }

  return s;
}

function parseColorsAny(raw: string): { colors: string[]; strokeColor: string } {
  let parsed: any = [];
  try { parsed = JSON.parse(raw || '[]'); } catch { parsed = []; }

  // accept array OR object format
  if (Array.isArray(parsed)) {
    const colors = parsed.map((c) => String(c).trim()).filter(Boolean);
    return { colors, strokeColor: colors[0] || '#000000' };
  }

  if (parsed && typeof parsed === 'object') {
    const strokeColor = typeof parsed.stroke === 'string' ? parsed.stroke : '#000000';
    const palette = Array.isArray(parsed.palette) ? parsed.palette : [];
    const colors = palette.map((c: any) => String(c).trim()).filter(Boolean);
    return { colors, strokeColor };
  }

  return { colors: [], strokeColor: '#000000' };
}

function toBool(v: any) {
  const s = String(v ?? '').toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

function isValidUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId);
}

function isSafeIdLike(s: unknown): s is string {
  // Allow ObjectId strings or simple tokens; reject Mongo operator-ish chars.
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && !/[.$\s]/.test(s);
}

function safeBaseName(fileName: string): string {
  const base = String(fileName || 'upload.svg').split(/[/\\]/).pop() || 'upload.svg';
  // Keep it GCS-friendly and predictable.
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

// =====================
// GET /api/svgdata?id=...
// Ionic uses this.
// Returns raw SVG text + PNG URL/dataURL.
// =====================
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const uid = await getUidIfPresent(req);

  if (!id) return json({ message: 'ID is required' }, 400);
  if (!ObjectId.isValid(id)) return json({ message: 'Invalid id' }, 400);

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());

    // ✅ Try created records first, then manual uploads
    const collectionsToTry = ['createdata', 'svgdata'] as const;

    let doc: any = null;
    let foundIn: string | null = null;

    for (const name of collectionsToTry) {
      const c = db.collection(name);
      doc = await c.findOne({ _id: new ObjectId(id) });
      if (doc) {
        foundIn = name;
        break;
      }
    }

    if (!doc) {
      return json({ message: 'Document not found', tried: collectionsToTry }, 404);
    }

    // If this record belongs to a user, only that user may read it.
    if (doc?.userId && typeof doc.userId === 'string') {
      if (!uid || uid !== doc.userId) {
        return json({ message: 'Forbidden' }, 403);
      }
    }

    // Map fields from either collection shape:
    const svgSource =
      doc.svgData ?? doc.svgUrl ?? doc.svg ?? doc.svg_path ?? '';
    const pngSource =
      doc.pngData ?? doc.pngUrl ?? doc.png ?? doc.png_path ?? '';

    // Ionic expects raw SVG text
    let rawSvgText = '';
    if (typeof svgSource === 'string') {
      if (isDataUrl(svgSource)) {
        rawSvgText = decodeSvgDataUrlToText(svgSource) || '';
      } else if (svgSource.trim().startsWith('<svg')) {
        rawSvgText = svgSource;
      } else if (svgSource) {
        const signedSvgUrl = await signReadUrl(svgSource);
        const r = await fetch(signedSvgUrl);
        if (!r.ok) return json({ message: 'Failed to fetch SVG data' }, 500);
        rawSvgText = await r.text();
      }
    }

    let pngOut: string = typeof pngSource === 'string' ? pngSource : '';
    if (pngOut && !isDataUrl(pngOut)) {
      pngOut = await signReadUrl(pngOut);
    }

    return json(
      {
        _id: doc._id,
        sourceCollection: foundIn,
        colors: doc.colors || [],
        categories: doc.categories || [],
        date: doc.date || doc.createdAt || null,
        hasSimplifiedSvg: !!doc.hasSimplifiedSvg,
        svgData: rawSvgText,
        pngData: pngOut,
      },
      200
    );
  } catch (e: any) {
    return json({ message: e?.message || 'Failed to load svgdata' }, 500);
  }
}

// =====================
// POST /api/svgdata
// /upload-svg manual upload uses this.
// =====================
export async function POST(req: Request) {
  try {
    // ✅ Option B: derive user identity ONLY from verified Firebase ID token.
    // If no token is present, this upload becomes a public/library item (no userId stored).
    const uid = await getUidIfPresent(req);

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return json({ message: 'Please select an SVG file to upload.' }, 400);
    }

    // Basic file validation (size/type)
    const MAX_SVG_BYTES = 12 * 1024 * 1024; // 10 MB
    const nameLower = String(file.name || '').toLowerCase();
    const looksLikeSvg = nameLower.endsWith('.svg') || String(file.type || '') === 'image/svg+xml';
    if (!looksLikeSvg) {
      return json({ message: 'Only SVG files are allowed.' }, 400);
    }
    if (Number.isFinite(file.size) && file.size > MAX_SVG_BYTES) {
      return json({ message: 'SVG file is too large (max 10MB).' }, 400);
    }

    const colorsRaw = String(form.get('colors') ?? '[]');
    const categoriesRaw = String(form.get('categories') ?? '[]');
    const newCategoryRaw = String(form.get('newCategory') ?? '').trim();
    const newCategory =
      newCategoryRaw && newCategoryRaw.length <= 40 && /^[A-Za-z0-9 _-]{1,40}$/.test(newCategoryRaw)
        ? newCategoryRaw
        : '';
    const hasSimplifiedSvg = toBool(form.get('hasSimplifiedSvg'));
    const imageFile = form.get('imageFile');
    const levelId = String(form.get('levelId') || '').trim();
    // Ignore any userId sent by the client (never trust it). Use the verified uid.
    const userId = uid && isValidUserId(uid) ? uid : null;

    const { colors, strokeColor } = parseColorsAny(colorsRaw);

    let selectedCategories: string[] = [];
    try {
      const parsed = JSON.parse(categoriesRaw || '[]');
      selectedCategories = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      selectedCategories = [];
    }

    // Validate & de-dup category ids
    selectedCategories = Array.from(
      new Set(selectedCategories.map((c) => String(c).trim()).filter((c) => isSafeIdLike(c)))
    ).slice(0, 20);

    // Clamp palette size
    const safeColors = (colors || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 64);

    // Read original SVG
    const originalSvgData = await file.text();

    // Force fills to white & strokes to selected strokeColor (like route.js)
    let modifiedSvgData = originalSvgData
      .replace(/fill\s*=\s*['"][^'"]*['"]/gi, 'fill="#FFFFFF"')
      .replace(/fill\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi, 'fill:#FFFFFF;')
      .replace(/stroke\s*=\s*['"][^'"]*['"]/gi, `stroke="${strokeColor}"`)
      .replace(/stroke\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi, `stroke:${strokeColor};`);

    // Prepare preview image buffer (WebP):
    // - if user provided JPG/PNG, resize it
    // - else generate outline-only preview from thumbnail SVG
    let pngBuffer: Buffer; // variable name kept for backward compatibility
    let pngContentType = 'image/webp';
    let pngExt = 'webp';

    const envMaxDim = Number.parseInt(process.env.WEBP_MAX_DIM || process.env.PNG_MAX_DIM || '1024', 10) || 1024;

    const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
    if (imageFile instanceof File) {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowed.includes(imageFile.type)) {
        return json({ message: 'Only PNG, JPEG, or WebP images are allowed for preview.' }, 400);
      }
      if (Number.isFinite(imageFile.size) && imageFile.size > MAX_IMAGE_BYTES) {
        return json({ message: 'Preview image is too large (max 10MB).' }, 400);
      }
      const ab = await imageFile.arrayBuffer();
      const raw = Buffer.from(ab);

      const meta = await sharp(raw).metadata();
      const w = meta.width || 1024;
      const h = meta.height || 1024;

      const reducedW = Math.max(1, Math.floor(w * 0.9));
      const reducedH = Math.max(1, Math.floor(h * 0.9));

      {
        const raster = await optimiseRaster(raw, {
          maxDim: Math.min(envMaxDim, Math.max(reducedW, reducedH)),
          background: '#ffffff',
        });
        pngBuffer = raster.buffer;
        pngContentType = raster.contentType;
        pngExt = raster.ext;
      }
    } else {
      const thumbSvg = buildThumbnailSvg(modifiedSvgData, strokeColor);
      const thumbBuf = Buffer.from(thumbSvg, 'utf8');

      const meta = await sharp(thumbBuf).metadata();
      const w = meta.width || 1024;
      const h = meta.height || 1024;

      const reducedW = Math.max(1, Math.floor(w * 0.9));
      const reducedH = Math.max(1, Math.floor(h * 0.9));

      // Outline-only thumbnails compress extremely well with a tiny palette.
      {
        const raster = await optimiseRaster(thumbBuf, {
          maxDim: Math.min(envMaxDim, Math.max(reducedW, reducedH)),
          // Hint: outline-only thumbnails are effectively low-palette.
          maxColors: 16,
          minColors: 2,
          background: '#ffffff',
        });
        pngBuffer = raster.buffer;
        pngContentType = raster.contentType;
        pngExt = raster.ext;
      }
    }

    // Upload to GCS if configured; otherwise fallback to data URLs
    const bucketName = getBucketName();
    const storage = getStorage();

    const rnd = Math.floor(Math.random() * 1_000_000);
    const safeName = safeBaseName(file.name);
    const svgObjectPath = `svgs/${safeName}-${rnd}.svg`;
    const pngObjectPath = `images/${safeName}-${rnd}.${pngExt}`;

    let svgDataStored = '';
    let pngDataStored = '';

    const svgBuffer = Buffer.from(modifiedSvgData, 'utf8');

    if (bucketName && storage) {
      try {
        const bucket = storage.bucket(bucketName);

        await bucket.file(svgObjectPath).save(svgBuffer, {
          resumable: false,
          metadata: { contentType: 'image/svg+xml' },
        });

        await bucket.file(pngObjectPath).save(pngBuffer, {
          resumable: false,
          metadata: { contentType: pngContentType },
        });

        svgDataStored = `https://storage.googleapis.com/${bucketName}/${svgObjectPath}`;
        pngDataStored = `https://storage.googleapis.com/${bucketName}/${pngObjectPath}`;
      } catch {
        // fallback to data URLs
        svgDataStored = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
        const prefix = `data:${pngContentType};base64,`;
        pngDataStored = `${prefix}${pngBuffer.toString('base64')}`;
      }
    } else {
      svgDataStored = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
      const prefix = `data:${pngContentType};base64,`;
      pngDataStored = `${prefix}${pngBuffer.toString('base64')}`;
    }

    // Save to MongoDB
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const svgDataCollection = db.collection('svgdata');
    const categoriesCollection = db.collection('categories');

    let safeLevelId = '';
    if (levelId) {
      const config = await getGameConfig(db);
      if (!isValidLevelId(levelId, config.levels)) return json({ message: 'Invalid level id.' }, 400);
      safeLevelId = levelId;
    }

    // Optional create category
    if (newCategory) {
      const existing = await categoriesCollection.findOne({ name: newCategory });
      if (existing?._id) {
        const idStr = String(existing._id);
        if (!selectedCategories.includes(idStr)) selectedCategories.push(idStr);
      } else {
        const inserted = await categoriesCollection.insertOne({ name: newCategory, createdAt: new Date() });
        const idStr = String(inserted.insertedId);
        if (!selectedCategories.includes(idStr)) selectedCategories.push(idStr);
      }
    }

    const insertDoc: any = {
      svgData: svgDataStored,
      pngData: pngDataStored,
      colors: safeColors,
      categories: selectedCategories,
      hasSimplifiedSvg,
      createdAt: new Date(),
      updatedAt: new Date(),
      date: new Date().toISOString(),
    };

    // Only store userId when it is a valid, non-empty UID.
    // If omitted, this becomes a public/library item.
    if (userId) insertDoc.userId = userId;
    if (safeLevelId) insertDoc.levelId = safeLevelId;

    const insertRes = await svgDataCollection.insertOne(insertDoc);

    return json(
      {
        message: 'Data inserted successfully',
        recordId: insertRes.insertedId.toString(),
        svgData: svgDataStored,
        pngData: pngDataStored,
        colors: safeColors,
        categories: selectedCategories,
        hasSimplifiedSvg,
        levelId: safeLevelId || null,
      },
      200
    );
  } catch (e: any) {
    return json({ message: e?.message || 'Upload failed' }, 500);
  }
}
