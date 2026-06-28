/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from 'mongodb';
import { GAME_LEVELS, normalizeGameLevels, type GameLevel } from '@/lib/levelSystem';

export type DailyRewardConfig = {
  rewardCoins: number;
  streakRewardDays: number;
  specialPackId: string;
  specialPackName: string;
  iconImageUrl?: string | null;
  specialPackImageUrl?: string | null;
  manualImageByDate: Record<string, string>;
};

export type GameConfig = {
  dailyReward: DailyRewardConfig;
  levels: GameLevel[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

const CONFIG_COLLECTION = 'appSettings';
const CONFIG_ID = 'game-features';

export const DEFAULT_GAME_CONFIG: GameConfig = {
  dailyReward: {
    rewardCoins: Number.parseInt(process.env.DAILY_REWARD_COINS || '50', 10) || 50,
    streakRewardDays: Number.parseInt(process.env.DAILY_STREAK_REWARD_DAYS || '7', 10) || 7,
    specialPackId: process.env.DAILY_SPECIAL_PACK_ID || 'daily-streak-special-pack',
    specialPackName: process.env.DAILY_SPECIAL_PACK_NAME || 'Special Daily Streak Pack',
    iconImageUrl: null,
    specialPackImageUrl: null,
    manualImageByDate: {},
  },
  levels: GAME_LEVELS,
  updatedAt: null,
  updatedBy: null,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, maxLength);
}


function safeAssetUrl(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 2048) return null;
  // Store stable local game asset URLs, data URLs, or normal HTTP(S) URLs only.
  if (text.startsWith('/api/game-assets/')) return text.split('?')[0];
  if (text.startsWith('data:image/webp;base64,')) return text;
  if (/^https?:\/\//i.test(text)) return text.split('?')[0];
  return null;
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeManualImageByDate(value: unknown): Record<string, string> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const [date, imageId] of Object.entries(source)) {
    const cleanedDate = String(date).trim();
    const cleanedImageId = String(imageId || '').trim();
    if (isDateKey(cleanedDate) && cleanedImageId && cleanedImageId.length <= 64) {
      out[cleanedDate] = cleanedImageId;
    }
  }
  return out;
}

export function normalizeGameConfig(raw: any): GameConfig {
  const source = raw && typeof raw === 'object' ? raw : {};
  const daily = source.dailyReward && typeof source.dailyReward === 'object' ? source.dailyReward : {};

  return {
    dailyReward: {
      rewardCoins: clampInt(daily.rewardCoins, DEFAULT_GAME_CONFIG.dailyReward.rewardCoins, 0, 99999),
      streakRewardDays: clampInt(daily.streakRewardDays, DEFAULT_GAME_CONFIG.dailyReward.streakRewardDays, 1, 365),
      specialPackId: safeText(daily.specialPackId, DEFAULT_GAME_CONFIG.dailyReward.specialPackId, 80),
      specialPackName: safeText(daily.specialPackName, DEFAULT_GAME_CONFIG.dailyReward.specialPackName, 80),
      iconImageUrl: safeAssetUrl(daily.iconImageUrl),
      specialPackImageUrl: safeAssetUrl(daily.specialPackImageUrl),
      manualImageByDate: normalizeManualImageByDate(daily.manualImageByDate),
    },
    levels: normalizeGameLevels(source.levels),
    updatedAt: source.updatedAt instanceof Date ? source.updatedAt.toISOString() : (typeof source.updatedAt === 'string' ? source.updatedAt : null),
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : null,
  };
}

export async function getGameConfig(db: Db): Promise<GameConfig> {
  const raw = await db.collection<any>(CONFIG_COLLECTION).findOne({ _id: CONFIG_ID });
  return normalizeGameConfig(raw);
}

export async function saveGameConfig(db: Db, patch: Partial<GameConfig>, updatedBy: string): Promise<GameConfig> {
  const current = await getGameConfig(db);
  const next = normalizeGameConfig({
    ...current,
    ...patch,
    dailyReward: {
      ...current.dailyReward,
      ...(patch.dailyReward || {}),
      manualImageByDate: {
        ...current.dailyReward.manualImageByDate,
        ...(patch.dailyReward?.manualImageByDate || {}),
      },
    },
    levels: patch.levels || current.levels,
  });

  const now = new Date();
  await db.collection<any>(CONFIG_COLLECTION).updateOne(
    { _id: CONFIG_ID },
    {
      $set: {
        dailyReward: next.dailyReward,
        levels: next.levels,
        updatedAt: now,
        updatedBy,
      },
      $setOnInsert: { _id: CONFIG_ID, createdAt: now },
    },
    { upsert: true },
  );

  return { ...next, updatedAt: now.toISOString(), updatedBy };
}

export function getManualDailyImageId(config: GameConfig, dateKey: string): string | null {
  return config.dailyReward.manualImageByDate?.[dateKey] || null;
}

function makeAbsoluteAssetUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  if (value.startsWith('/api/game-assets/')) return `${origin}${value}`;
  return value;
}

export function publicGameConfig(config: GameConfig, origin: string): GameConfig {
  return {
    ...config,
    dailyReward: {
      ...config.dailyReward,
      iconImageUrl: makeAbsoluteAssetUrl(config.dailyReward.iconImageUrl, origin),
      specialPackImageUrl: makeAbsoluteAssetUrl(config.dailyReward.specialPackImageUrl, origin),
    },
    levels: config.levels.map((level) => ({
      ...level,
      iconImageUrl: makeAbsoluteAssetUrl(level.iconImageUrl, origin),
    })),
  };
}
