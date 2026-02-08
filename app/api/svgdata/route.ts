import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage } from '@/lib/gcs';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function toBool(v: any): boolean {
  const s = (v ?? '').toString().toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();

    const file = form.get('file');
    if (!(file instanceof File)) {
      return json({ message: 'Please select an SVG file to upload.' }, 400);
    }

    const colorsRaw = form.get('colors')?.toString() || '[]';
    const categoriesRaw = form.get('categories')?.toString() || '[]';
    const newCategory = (form.get('newCategory')?.toString() || '').trim();
    const hasSimplifiedSvg = toBool(form.get('hasSimplifiedSvg'));
    const imageFile = form.get('imageFile'); // optional (png/jpg)

    let colors: string[] = [];
    let categoryIds: string[] = [];

    try { colors = JSON.parse(colorsRaw) || []; } catch { colors = []; }
    try { categoryIds = JSON.parse(categoriesRaw) || []; } catch { categoryIds = []; }

    colors = (Array.isArray(colors) ? colors : []).map((c) => String(c).trim()).filter(Boolean);
    categoryIds = (Array.isArray(categoryIds) ? categoryIds : []).map((id) => String(id).trim()).filter(Boolean);

    const svgString = await file.text();
    const svgBuffer = Buffer.from(svgString, 'utf-8');

    // PNG preview from SVG (server-side)
    const pngBuffer = await sharp(svgBuffer, { density: 300 }).png().toBuffer();

    // Store assets (prefer GCS; fallback to data URLs if upload fails)
    let publicUrlSvg = '';
    let publicUrlPng = '';

    const bucketName = getBucketName();
    const randomNumber = Math.floor(Math.random() * 1_000_000);
    const svgFilePath = `svgs/uploaded-${randomNumber}.svg`;
    const pngFilePath = `images/uploaded-${randomNumber}.png`;

    try {
      const storage = getStorage();
      const bucket = storage.bucket(bucketName);

      await bucket.file(svgFilePath).save(svgString, {
        resumable: false,
        metadata: { contentType: 'image/svg+xml' },
      });

      await bucket.file(pngFilePath).save(pngBuffer, {
        resumable: false,
        metadata: { contentType: 'image/png' },
      });

      publicUrlSvg = `https://storage.googleapis.com/${bucketName}/${svgFilePath}`;
      publicUrlPng = `https://storage.googleapis.com/${bucketName}/${pngFilePath}`;
    } catch (e: any) {
      logger.error('GCS upload failed; falling back to data URLs', { error: e?.message || e });
      publicUrlSvg = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
      publicUrlPng = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    }

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const svgDataCollection = db.collection('svgdata');
    const categoriesCollection = db.collection('categories');

    // Optional: create a new category name if provided
    if (newCategory) {
      const existing = await categoriesCollection.findOne({ name: newCategory });
      if (existing?._id) {
        categoryIds = Array.from(new Set([...categoryIds, String(existing._id)]));
      } else {
        const inserted = await categoriesCollection.insertOne({ name: newCategory, createdAt: new Date() });
        categoryIds = Array.from(new Set([...categoryIds, String(inserted.insertedId)]));
      }
    }

    const userId = (form.get('userId')?.toString() || 'anonymous').trim() || 'anonymous';

    const record = {
      userId,
      svgData: publicUrlSvg,
      pngData: publicUrlPng,
      colors,
      categories: categoryIds,
      hasSimplifiedSvg,
      originalSvgFileName: file.name,
      hasImageFile: imageFile instanceof File,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertRes = await svgDataCollection.insertOne(record);

    logger.log('SVG data uploaded', { recordId: insertRes.insertedId.toString(), userId });

    return json(
      {
        message: 'SVG data uploaded successfully!',
        recordId: insertRes.insertedId,
        publicUrlSvg,
        publicUrlPng,
      },
      200
    );
  } catch (error: any) {
    logger.error('Error uploading SVG data', { error: error?.message || error });
    return json({ message: 'An error occurred while uploading the SVG data.' }, 500);
  }
}
