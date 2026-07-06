/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from 'mongodb';

export type HintType = 'find_number' | 'highlight_same_number' | 'auto_fill_area';

export type HintEconomyConfig = {
  dailyFreeHints: number;
  coinCost: number;
  maxStoredFreeHints: number;
};

export const HINT_TYPES: Array<{ id: HintType; name: string; description: string }> = [
  { id: 'find_number', name: 'Find Number', description: 'Point to one unpainted area for the selected number.' },
  { id: 'highlight_same_number', name: 'Highlight Same Number', description: 'Highlight several matching areas for the selected number.' },
  { id: 'auto_fill_area', name: 'Auto-fill Area', description: 'Fill one small unpainted matching area.' },
];

export function getHintEconomyConfig(): HintEconomyConfig {
  const dailyFreeHints = clampInt(process.env.HINT_DAILY_FREE || '3', 3, 0, 99);
  const coinCost = clampInt(process.env.HINT_COIN_COST || '25', 25, 0, 99999);
  const maxStoredFreeHints = clampInt(process.env.HINT_MAX_STORED_FREE || '9', 9, dailyFreeHints, 999);
  return { dailyFreeHints, coinCost, maxStoredFreeHints };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function cleanSafeId(value: unknown, fieldName: string, maxLength = 160): string | null {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return null;
  if (cleaned.length > maxLength) throw new Error(`${fieldName} is too long.`);
  if (!/^[A-Za-z0-9:_./-]+$/.test(cleaned)) throw new Error(`${fieldName} contains unsupported characters.`);
  return cleaned;
}

export function parseHintType(value: unknown): HintType {
  const type = String(value || 'highlight_same_number').trim().toLowerCase();
  if (type === 'find_number' || type === 'highlight_same_number' || type === 'auto_fill_area') return type;
  throw new Error('type must be find_number, highlight_same_number, or auto_fill_area.');
}

function uniqueDateKeys(values: any[], max = 120): string[] {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((x: any) => String(x || '').trim().slice(0, 10))
    .filter((x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x))))
    .sort()
    .slice(-max);
}

export function normalizeHintEconomy(raw: any, config = getHintEconomyConfig()) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const daily = source.daily && typeof source.daily === 'object' ? source.daily : {};
  const today = todayKey();
  const claimedDates = uniqueDateKeys(daily.claimedDates, 120);

  return {
    freeHints: clampInt(source.freeHints, 0, 0, config.maxStoredFreeHints),
    lifetimeUsed: clampInt(source.lifetimeUsed, 0, 0, Number.MAX_SAFE_INTEGER),
    lifetimeClaimed: clampInt(source.lifetimeClaimed, 0, 0, Number.MAX_SAFE_INTEGER),
    daily: {
      lastClaimDate: typeof daily.lastClaimDate === 'string' ? daily.lastClaimDate.slice(0, 10) : null,
      claimedDates,
      lastUseDate: typeof daily.lastUseDate === 'string' ? daily.lastUseDate.slice(0, 10) : null,
      usedToday: daily.lastUseDate === today ? clampInt(daily.usedToday, 0, 0, 99999) : 0,
    },
  };
}

export function normalizeDailyReward(raw: any) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    coins: clampInt(source.coins, 0, 0, Number.MAX_SAFE_INTEGER),
    streak: clampInt(source.streak, 0, 0, Number.MAX_SAFE_INTEGER),
    lastClaimDate: typeof source.lastClaimDate === 'string' ? source.lastClaimDate.slice(0, 10) : null,
    claimedDates: uniqueDateKeys(source.claimedDates, 120),
    unlockedSpecialPacks: Array.isArray(source.unlockedSpecialPacks)
      ? Array.from(new Set(source.unlockedSpecialPacks.map((x: any) => String(x || '').trim()).filter(Boolean))).slice(0, 100)
      : [],
  };
}

export function publicHintStatus(userDoc: any, signedIn: boolean, isAnonymous: boolean, config = getHintEconomyConfig()) {
  const today = todayKey();
  const hintEconomy = normalizeHintEconomy(userDoc?.hintEconomy, config);
  const reward = normalizeDailyReward(userDoc?.dailyReward);
  const claimedToday = hintEconomy.daily.claimedDates.includes(today) || hintEconomy.daily.lastClaimDate === today;

  return {
    signedIn,
    isAnonymous,
    freeHints: hintEconomy.freeHints,
    coins: reward.coins,
    dailyFreeHints: config.dailyFreeHints,
    coinCost: config.coinCost,
    maxStoredFreeHints: config.maxStoredFreeHints,
    canClaimDaily: !claimedToday && hintEconomy.freeHints < config.maxStoredFreeHints && config.dailyFreeHints > 0,
    claimedToday,
    usedToday: hintEconomy.daily.usedToday,
    lifetimeUsed: hintEconomy.lifetimeUsed,
    lifetimeClaimed: hintEconomy.lifetimeClaimed,
    lastClaimDate: hintEconomy.daily.lastClaimDate,
    types: HINT_TYPES,
  };
}

export async function ensureHintIndexes(db: Db) {
  try {
    await Promise.all([
      db.collection('hintEvents').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('hintEvents').createIndex(
        { userId: 1, clientHintId: 1 },
        {
          unique: true,
          partialFilterExpression: { clientHintId: { $type: 'string' } },
        }
      ),
    ]);
  } catch {
    // Index creation should never break gameplay.
  }
}
