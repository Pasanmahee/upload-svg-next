/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getUidIfPresent } from '@/lib/auth';
import { getLeaderboard, parseLeaderboardLimit, parseLeaderboardType } from '@/lib/leaderboards';

export const runtime = 'nodejs';

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    Vary: 'Authorization',
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: headers() });
}

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
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = parseLeaderboardType(url.searchParams.get('type'));
    const limit = parseLeaderboardLimit(url.searchParams.get('limit'));
    const currentUid = await getUidIfPresent(request);

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const entries = await getLeaderboard(db, type, currentUid, limit);

    return json({
      success: true,
      type,
      limit,
      generatedAt: new Date().toISOString(),
      entries,
    });
  } catch (e) {
    return json({ error: 'Failed to load leaderboard', details: getErrorMessage(e) }, 500);
  }
}
