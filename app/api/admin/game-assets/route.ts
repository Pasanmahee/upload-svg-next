/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import { optimiseGameAssetImage, safeAssetPurpose } from '@/lib/gameAssetImages';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = Number.parseInt(process.env.GAME_ASSET_MAX_UPLOAD_MB || '8', 10) * 1024 * 1024;

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email',
    'Cache-Control': 'no-store',
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: headers() });
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

function safeOriginalName(value: unknown): string {
  const base = String(value || 'game-asset').split(/[/\\]/).pop() || 'game-asset';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function POST(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  try {
    const form = await request.formData();
    const file = form.get('image');
    const purpose = safeAssetPurpose(form.get('purpose'));

    if (!(file instanceof File)) {
      return json({ error: 'No image file found. Use form field name "image".' }, 400);
    }

    if (!file.type.startsWith('image/')) {
      return json({ error: 'Only image files are allowed.' }, 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: `Image is too large. Maximum upload is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` }, 413);
    }

    const input = Buffer.from(await file.arrayBuffer());
    const optimised = await optimiseGameAssetImage(input);
    const id = crypto.randomUUID();
    const now = new Date();

    const client = await getMongoClient();
    const db = client.db(getDbName());
    await db.collection('gameAssets').insertOne({
      _id: id,
      purpose,
      originalName: safeOriginalName(file.name),
      contentType: optimised.contentType,
      ext: optimised.ext,
      sizeBytes: optimised.buffer.length,
      width: optimised.width,
      height: optimised.height,
      data: optimised.buffer,
      createdAt: now,
      createdBy: admin.email,
    } as any);

    const url = `/api/game-assets/${id}`;
    return json({
      ok: true,
      asset: {
        id,
        purpose,
        url,
        contentType: optimised.contentType,
        ext: optimised.ext,
        sizeBytes: optimised.buffer.length,
        width: optimised.width,
        height: optimised.height,
      },
    });
  } catch (err: unknown) {
    return json({ error: 'Failed to upload and optimise game image', details: getErrorMessage(err) }, 500);
  }
}
