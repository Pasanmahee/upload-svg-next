/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from 'mongodb';
import { normalizeLevelProgress, normalizeGameLevels } from '@/lib/levelSystem';

export type AchievementState = {
  achievements: any[];
  newlyUnlocked: any[];
  stats: {
    totalAchievements: number;
    unlockedAchievements: number;
  };
};

const FIVE_MINUTES_SECONDS = 5 * 60;
const FAST_PAINTER_MIN_ACCURACY = 90;

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  try {
    if (typeof v?.toISOString === 'function') return v.toISOString();
  } catch {
    // ignore
  }
  return String(v);
}

function uniqueCount(values: any[]): number {
  return new Set((Array.isArray(values) ? values : []).map((x) => String(x)).filter(Boolean)).size;
}

function flowerTarget(levels: any[]): number {
  const normalized = normalizeGameLevels(levels);
  const flowers = normalized.find((level) => level.id === 'flowers');
  return Math.max(1, Number(flowers?.requiredToUnlockNext || 3));
}

export function getAchievementDefinitions(levels: any[] = []) {
  const flowerRequired = flowerTarget(levels);
  return [
    {
      id: 'first-picture-completed',
      name: 'First Picture Completed',
      description: 'Complete your first coloring picture.',
      icon: '🎉',
      metric: 'totalCompletions',
      target: 1,
    },
    {
      id: 'ten-pictures-completed',
      name: '10 Pictures Completed',
      description: 'Complete 10 coloring pictures.',
      icon: '🔟',
      metric: 'totalCompletions',
      target: 10,
    },
    {
      id: 'no-mistake-master',
      name: 'No Mistake Master',
      description: 'Complete one picture without any mistakes.',
      icon: '🏅',
      metric: 'noMistakeCompletions',
      target: 1,
    },
    {
      id: 'fast-painter',
      name: 'Fast Painter',
      description: `Complete one picture within ${FIVE_MINUTES_SECONDS / 60} minutes with at least ${FAST_PAINTER_MIN_ACCURACY}% accuracy.`,
      icon: '⚡',
      metric: 'fastCompletions',
      target: 1,
    },
    {
      id: 'flower-collection-completed',
      name: 'Flower Collection Completed',
      description: `Complete ${flowerRequired} flower pictures.`,
      icon: '🌸',
      metric: 'flowerCompletions',
      target: flowerRequired,
    },
  ];
}

async function buildAchievementMetrics(db: Db, userId: string, levels: any[], userDoc: any) {
  const completions = db.collection<any>('completions');
  const levelProgress = normalizeLevelProgress(userDoc?.levelProgress, levels);
  const totalCompletionsFromStats = Number(userDoc?.completionStats?.totalCompletions || 0);

  const [totalFromCollection, noMistakeCompletions, fastCompletions] = await Promise.all([
    totalCompletionsFromStats > 0 ? Promise.resolve(totalCompletionsFromStats) : completions.countDocuments({ userId }),
    completions.countDocuments({ userId, mistakes: 0 }),
    completions.countDocuments({
      userId,
      timeSeconds: { $lte: FIVE_MINUTES_SECONDS },
      accuracy: { $gte: FAST_PAINTER_MIN_ACCURACY },
    }),
  ]);

  return {
    totalCompletions: Math.max(0, Number(totalFromCollection || 0)),
    noMistakeCompletions: Math.max(0, Number(noMistakeCompletions || 0)),
    fastCompletions: Math.max(0, Number(fastCompletions || 0)),
    flowerCompletions: uniqueCount(levelProgress.completedImagesByLevel?.flowers || []),
  };
}

function serializeItem(definition: any, existing: any, metricValue: number, now: Date) {
  const progress = Math.min(Math.max(0, Number(metricValue || 0)), definition.target);
  const unlocked = progress >= definition.target;
  const alreadyUnlockedAt = existing?.unlockedAt || null;
  const unlockedAt = unlocked ? toIso(alreadyUnlockedAt) || now.toISOString() : null;
  const updatedAt = now.toISOString();

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    icon: definition.icon,
    metric: definition.metric,
    progress,
    target: definition.target,
    percentage: definition.target > 0 ? Math.min(100, Math.round((progress / definition.target) * 100)) : 100,
    unlocked,
    unlockedAt,
    updatedAt,
  };
}

let achievementIndexesPromise: Promise<void> | null = null;

async function ensureAchievementIndexes(db: Db) {
  if (!achievementIndexesPromise) {
    achievementIndexesPromise = Promise.all([
      db.collection<any>('completions').createIndex({ userId: 1, mistakes: 1 }),
      db.collection<any>('completions').createIndex({ userId: 1, timeSeconds: 1, accuracy: 1 }),
    ]).then(() => undefined).catch(() => undefined);
  }
  await achievementIndexesPromise;
}

export async function updateUserAchievements(db: Db, userId: string, levels: any[], now: Date = new Date()): Promise<AchievementState> {
  await ensureAchievementIndexes(db);

  const users = db.collection<any>('users');
  const userDoc = await users.findOne({ _id: userId }, { projection: { levelProgress: 1, completionStats: 1, achievementProgress: 1 } });
  const definitions = getAchievementDefinitions(levels);
  const metrics = await buildAchievementMetrics(db, userId, levels, userDoc || {});
  const existingItems = userDoc?.achievementProgress?.items && typeof userDoc.achievementProgress.items === 'object'
    ? userDoc.achievementProgress.items
    : {};

  const achievements = definitions.map((definition) => {
    const metricValue = Number((metrics as any)[definition.metric] || 0);
    return serializeItem(definition, existingItems[definition.id], metricValue, now);
  });

  const newlyUnlocked = achievements.filter((item) => {
    const existing = existingItems[item.id];
    return item.unlocked && !existing?.unlocked;
  });

  const itemsForStorage = achievements.reduce((acc: Record<string, any>, item: any) => {
    acc[item.id] = {
      progress: item.progress,
      target: item.target,
      percentage: item.percentage,
      unlocked: item.unlocked,
      unlockedAt: item.unlockedAt,
      updatedAt: item.updatedAt,
    };
    return acc;
  }, {});

  await users.updateOne(
    { _id: userId },
    {
      $setOnInsert: { _id: userId, uid: userId, createdAt: now },
      $set: {
        updatedAt: now,
        achievementProgress: {
          items: itemsForStorage,
          lastUpdatedAt: now,
          totalAchievements: achievements.length,
          unlockedAchievements: achievements.filter((item) => item.unlocked).length,
        },
      },
    },
    { upsert: true }
  );

  return {
    achievements,
    newlyUnlocked,
    stats: {
      totalAchievements: achievements.length,
      unlockedAchievements: achievements.filter((item) => item.unlocked).length,
    },
  };
}
