import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';

export const runtime = 'nodejs';

function setCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Email',
  };
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // YYYY-MM-DD
  const m = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;

  // Real calendar check (handles month length + leap years)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

type UserProfileDoc = {
  _id: string; // uid
  uid: string;
  birthdate?: string | null;
  parentEmail?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: setCORSHeaders() });
}

export async function GET(request: Request) {
  const cors = setCORSHeaders();

  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  const client = await getMongoClient();
  const db = client.db(getDbName());
  const users = db.collection<UserProfileDoc>('users');

  const doc = await users.findOne({ _id: auth.uid });

  return NextResponse.json(
    {
      uid: auth.uid,
      birthdate: doc?.birthdate ?? null,
      parentEmail: doc?.parentEmail ?? null,
    },
    { status: 200, headers: cors },
  );
}

export async function PUT(request: Request) {
  const cors = setCORSHeaders();

  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const birthdate = body?.birthdate;
  const parentEmail = typeof body?.parentEmail === 'string' ? body.parentEmail.trim() : undefined;

  if (birthdate !== undefined && birthdate !== null && !isValidDateOnly(birthdate)) {
    return NextResponse.json({ error: 'Invalid birthdate. Use YYYY-MM-DD.' }, { status: 400, headers: cors });
  }

  const now = new Date();

  const $set: any = { updatedAt: now };
  if (birthdate !== undefined) $set.birthdate = birthdate ?? null;
  if (parentEmail !== undefined) $set.parentEmail = parentEmail || null;

  const client = await getMongoClient();
  const db = client.db(getDbName());
  const users = db.collection<UserProfileDoc>('users');

  await users.updateOne(
    { _id: auth.uid },
    {
      $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
      $set,
    },
    { upsert: true },
  );

  return NextResponse.json(
    { success: true, message: 'Profile updated.', birthdate: birthdate ?? null, parentEmail: parentEmail ?? null },
    { status: 200, headers: cors },
  );
}
