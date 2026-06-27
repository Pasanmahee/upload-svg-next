/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import { getGameConfig, saveGameConfig } from '@/lib/gameConfig';
import { normalizeGameLevels } from '@/lib/levelSystem';

export const runtime = 'nodejs';

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function GET(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const config = await getGameConfig(db);
    return json({ ok: true, config });
  } catch (err: unknown) {
    return json({ error: 'Failed to load game settings', details: getErrorMessage(err) }, 500);
  }
}

export async function PATCH(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());

    const patch: any = {};

    if (body?.dailyReward && typeof body.dailyReward === 'object') {
      patch.dailyReward = { ...body.dailyReward };

      const manual = patch.dailyReward.manualImageByDate;
      if (manual && typeof manual === 'object') {
        for (const [date, imageId] of Object.entries(manual)) {
          const cleanedDate = String(date).trim();
          const cleanedImageId = String(imageId || '').trim();
          if (!isDateKey(cleanedDate)) return json({ error: `Invalid date key: ${date}` }, 400);
          if (cleanedImageId && !ObjectId.isValid(cleanedImageId)) return json({ error: `Invalid image id for ${date}` }, 400);
        }
      }
    }

    if (Array.isArray(body?.levels)) {
      const levels = normalizeGameLevels(body.levels);
      if (!levels.some((level) => level.id === 'beginner')) {
        return json({ error: 'At least one beginner level must exist.' }, 400);
      }
      patch.levels = levels;
    }

    const config = await saveGameConfig(db, patch, admin.email);
    return json({ ok: true, config });
  } catch (err: unknown) {
    return json({ error: 'Failed to save game settings', details: getErrorMessage(err) }, 500);
  }
}
