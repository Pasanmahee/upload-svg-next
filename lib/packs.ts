/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from 'mongodb';

export type PackUnlockType = 'free' | 'premium' | 'rewarded' | 'streak' | 'achievement' | 'admin' | 'coins';

export type PackDocument = {
  _id?: any;
  packId: string;
  title: string;
  description: string;
  coverImageUrl?: string | null;
  type: PackUnlockType;
  priceCoins: number;
  requiredStreak?: number | null;
  requiredAchievementId?: string | null;
  imageIds: string[];
  manifestUrl?: string | null;
  manifestVersion: number;
  sizeBytes: number;
  isActive: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export const PACK_TYPES: PackUnlockType[] = ['free', 'premium', 'rewarded', 'streak', 'achievement', 'admin', 'coins'];

const DEFAULT_PACKS: PackDocument[] = [
  {
    packId: 'starter_free_pack',
    title: 'Starter Free Pack',
    description: 'A small free pack for testing downloadable packs.',
    coverImageUrl: null,
    type: 'free',
    priceCoins: 0,
    imageIds: [],
    manifestUrl: null,
    manifestVersion: 1,
    sizeBytes: 0,
    isActive: true,
    sortOrder: 10,
  },
  {
    packId: 'daily_streak_special_pack',
    title: '7-Day Streak Pack',
    description: 'Unlock this special pack after a 7-day daily challenge streak.',
    coverImageUrl: null,
    type: 'streak',
    priceCoins: 0,
    requiredStreak: 7,
    imageIds: [],
    manifestUrl: null,
    manifestVersion: 1,
    sizeBytes: 0,
    isActive: true,
    sortOrder: 20,
  },
  {
    packId: 'flower_bonus_pack',
    title: 'Flower Bonus Pack',
    description: 'A reward pack linked to the Flower Collection achievement.',
    coverImageUrl: null,
    type: 'achievement',
    priceCoins: 0,
    requiredAchievementId: 'flower-collection-completed',
    imageIds: [],
    manifestUrl: null,
    manifestVersion: 1,
    sizeBytes: 0,
    isActive: true,
    sortOrder: 30,
  },
  {
    packId: 'premium_mandala_pack',
    title: 'Premium Mandala Pack',
    description: 'Premium pack placeholder. Unlock with coins now; replace with real purchase later.',
    coverImageUrl: null,
    type: 'premium',
    priceCoins: 250,
    imageIds: [],
    manifestUrl: null,
    manifestVersion: 1,
    sizeBytes: 0,
    isActive: true,
    sortOrder: 40,
  },
  {
    packId: 'rewarded_animal_pack',
    title: 'Rewarded Animal Pack',
    description: 'Unlock after a rewarded ad is completed.',
    coverImageUrl: null,
    type: 'rewarded',
    priceCoins: 0,
    imageIds: [],
    manifestUrl: null,
    manifestVersion: 1,
    sizeBytes: 0,
    isActive: true,
    sortOrder: 50,
  },
];

let packIndexesPromise: Promise<void> | null = null;
let packSeedPromise: Promise<void> | null = null;

export function cleanPackId(value: unknown): string {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!id || id.length > 90) throw new Error('Invalid packId.');
  return id;
}

export function cleanText(value: unknown, maxLength = 240): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizePackType(value: unknown): PackUnlockType {
  const type = String(value || 'free').trim().toLowerCase() as PackUnlockType;
  return PACK_TYPES.includes(type) ? type : 'free';
}

export function normalizeImageIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter((item) => item && item.length <= 160 && /^[A-Za-z0-9:_./-]+$/.test(item)))).slice(0, 500);
}

export function parseNonNegativeInt(value: unknown, fallback = 0, max = 1_000_000_000): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 0), max);
}

export async function ensurePackIndexes(db: Db): Promise<void> {
  if (!packIndexesPromise) {
    packIndexesPromise = Promise.all([
      db.collection<any>('packs').createIndex({ packId: 1 }, { unique: true }),
      db.collection<any>('packs').createIndex({ isActive: 1, sortOrder: 1, title: 1 }),
      db.collection<any>('packOwnership').createIndex({ userId: 1, packId: 1 }, { unique: true }),
      db.collection<any>('packOwnership').createIndex({ userId: 1, unlockedAt: -1 }),
      db.collection<any>('packDownloads').createIndex({ userId: 1, packId: 1, createdAt: -1 }),
    ]).then(() => undefined).catch(() => undefined);
  }
  await packIndexesPromise;
}

export async function seedDefaultPacks(db: Db): Promise<void> {
  await ensurePackIndexes(db);
  if (!packSeedPromise) {
    const now = new Date();
    packSeedPromise = Promise.all(
      DEFAULT_PACKS.map((pack) =>
        db.collection<any>('packs').updateOne(
          { packId: pack.packId },
          {
            $setOnInsert: { ...pack, createdAt: now },
            $set: { updatedAt: now },
          },
          { upsert: true }
        )
      )
    ).then(() => undefined).catch(() => undefined);
  }
  await packSeedPromise;
}

export async function ensureAndSeedPacks(db: Db): Promise<void> {
  await ensurePackIndexes(db);
  await seedDefaultPacks(db);
}

export function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  try {
    if (typeof value?.toISOString === 'function') return value.toISOString();
  } catch {}
  return String(value);
}

export function packSizeLabel(bytes: unknown): string {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return 'Small';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
}

export function serializePack(pack: any, ownedPackIds: Set<string> = new Set(), downloadState?: any) {
  const packId = String(pack?.packId || '');
  const owned = ownedPackIds.has(packId);
  const downloaded = Boolean(downloadState?.downloaded);
  return {
    packId,
    title: String(pack?.title || packId),
    description: String(pack?.description || ''),
    coverImageUrl: pack?.coverImageUrl || null,
    type: normalizePackType(pack?.type),
    priceCoins: parseNonNegativeInt(pack?.priceCoins, 0, 1_000_000),
    requiredStreak: pack?.requiredStreak == null ? null : parseNonNegativeInt(pack.requiredStreak, 0, 3650),
    requiredAchievementId: pack?.requiredAchievementId || null,
    imageCount: Array.isArray(pack?.imageIds) ? pack.imageIds.length : 0,
    manifestVersion: parseNonNegativeInt(pack?.manifestVersion, 1, 999999),
    sizeBytes: parseNonNegativeInt(pack?.sizeBytes, 0, Number.MAX_SAFE_INTEGER),
    sizeLabel: packSizeLabel(pack?.sizeBytes),
    isActive: pack?.isActive !== false,
    sortOrder: parseNonNegativeInt(pack?.sortOrder, 0, 999999),
    owned,
    downloaded,
    downloadedAt: downloadState?.downloadedAt || null,
    deletedAt: downloadState?.deletedAt || null,
    status: owned ? (downloaded ? 'downloaded' : 'owned') : 'locked',
    createdAt: toIso(pack?.createdAt),
    updatedAt: toIso(pack?.updatedAt),
  };
}

export async function getOwnedPackIds(db: Db, userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await db.collection<any>('packOwnership').find({ userId }, { projection: { packId: 1 } }).toArray();
  return new Set(rows.map((row: any) => String(row.packId || '')).filter(Boolean));
}

export async function getDownloadedPackState(db: Db, userId: string | null): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (!userId) return out;
  const rows = await db.collection<any>('packDownloads')
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  for (const row of rows as any[]) {
    const packId = String(row.packId || '');
    if (!packId || out.has(packId)) continue;
    out.set(packId, {
      downloaded: row.action === 'download-started' || row.action === 'downloaded',
      downloadedAt: toIso(row.createdAt),
      deletedAt: row.action === 'deleted' ? toIso(row.createdAt) : null,
    });
  }
  return out;
}

export function buildPackManifest(pack: any, baseUrl: string) {
  const origin = baseUrl.replace(/\/$/, '');
  const imageIds = normalizeImageIds(pack?.imageIds);
  return {
    packId: String(pack?.packId || ''),
    version: parseNonNegativeInt(pack?.manifestVersion, 1, 999999),
    title: String(pack?.title || pack?.packId || ''),
    description: String(pack?.description || ''),
    type: normalizePackType(pack?.type),
    sizeBytes: parseNonNegativeInt(pack?.sizeBytes, 0, Number.MAX_SAFE_INTEGER),
    generatedAt: new Date().toISOString(),
    images: imageIds.map((imageId) => ({
      imageId,
      title: imageId,
      svgUrl: `${origin}/api/svgdata?id=${encodeURIComponent(imageId)}`,
      previewUrl: `${origin}/api/images/${encodeURIComponent(imageId)}`,
      downloadSvgUrl: `${origin}/api/images/${encodeURIComponent(imageId)}/download?kind=svg`,
      paletteUrl: `${origin}/api/images/${encodeURIComponent(imageId)}/download?kind=palette`,
      levelId: String(pack?.levelId || ''),
      difficulty: String(pack?.difficulty || ''),
    })),
  };
}

export async function canUnlockPack(db: Db, userId: string, pack: any, body: any = {}): Promise<{ ok: true; unlockType: PackUnlockType; coinsToDeduct?: number } | { ok: false; status: number; error: string }> {
  const type = normalizePackType(pack?.type);
  const users = db.collection<any>('users');
  const user = await users.findOne({ _id: userId }, { projection: { coins: 1, dailyReward: 1, achievementProgress: 1 } });

  if (type === 'free') return { ok: true, unlockType: 'free' };
  if (type === 'admin') return { ok: false, status: 403, error: 'This pack must be granted by an admin.' };

  if (type === 'streak') {
    const required = parseNonNegativeInt(pack?.requiredStreak, 7, 3650);
    const streak = parseNonNegativeInt((user as any)?.dailyReward?.streak, 0, 3650);
    if (streak >= required) return { ok: true, unlockType: 'streak' };
    return { ok: false, status: 403, error: `Requires a ${required}-day streak.` };
  }

  if (type === 'achievement') {
    const achievementId = String(pack?.requiredAchievementId || '').trim();
    const item = achievementId ? (user as any)?.achievementProgress?.items?.[achievementId] : null;
    if (item?.unlocked) return { ok: true, unlockType: 'achievement' };
    return { ok: false, status: 403, error: 'Required achievement is not unlocked yet.' };
  }

  if (type === 'rewarded') {
    if (body?.rewardedAdCompleted === true || body?.adRewardToken) return { ok: true, unlockType: 'rewarded' };
    return { ok: false, status: 402, error: 'Rewarded ad completion is required.' };
  }

  // Premium/coins pack MVP: unlock through coins until real in-app purchase is wired.
  const priceCoins = parseNonNegativeInt(pack?.priceCoins, 0, 1_000_000);
  const coins = parseNonNegativeInt((user as any)?.coins, 0, 1_000_000_000);
  if (priceCoins <= 0) return { ok: true, unlockType: type };
  if (coins < priceCoins) return { ok: false, status: 402, error: `Not enough coins. Need ${priceCoins} coins.` };
  return { ok: true, unlockType: 'coins', coinsToDeduct: priceCoins };
}
