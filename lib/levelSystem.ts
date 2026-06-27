/* eslint-disable @typescript-eslint/no-explicit-any */

export type GameLevel = {
  id: string;
  name: string;
  shortName: string;
  emoji: string;
  description: string;
  requiredToUnlockNext: number;
  keywords: string[];
};

export const GAME_LEVELS: GameLevel[] = [
  {
    id: 'beginner',
    name: 'Beginner',
    shortName: 'Beginner',
    emoji: '🌱',
    description: 'Simple first puzzles',
    requiredToUnlockNext: 2,
    keywords: ['beginner', 'starter', 'easy', 'simple', 'offline', 'woman'],
  },
  {
    id: 'easy-animals',
    name: 'Easy Animals',
    shortName: 'Animals',
    emoji: '🐾',
    description: 'Cute animal pictures',
    requiredToUnlockNext: 3,
    keywords: ['animal', 'animals', 'bird', 'birds', 'kingfisher', 'cat', 'dog', 'fish', 'butterfly', 'horse', 'panda'],
  },
  {
    id: 'flowers',
    name: 'Flowers',
    shortName: 'Flowers',
    emoji: '🌸',
    description: 'Flower coloring pack',
    requiredToUnlockNext: 3,
    keywords: ['flower', 'flowers', 'floral', 'rose', 'lotus', 'garden', 'nature', 'leaf', 'plant'],
  },
  {
    id: 'cartoons',
    name: 'Cartoons',
    shortName: 'Cartoons',
    emoji: '🎨',
    description: 'Fun cartoon images',
    requiredToUnlockNext: 4,
    keywords: ['cartoon', 'cartoons', 'cute', 'kids', 'child', 'princess', 'character', 'kawaii'],
  },
  {
    id: 'hard-mandala',
    name: 'Hard Mandala',
    shortName: 'Mandala',
    emoji: '🌀',
    description: 'Detailed mandalas',
    requiredToUnlockNext: 4,
    keywords: ['mandala', 'pattern', 'patterns', 'ornament', 'complex', 'detail', 'detailed'],
  },
  {
    id: 'expert-pixel-art',
    name: 'Expert Pixel Art',
    shortName: 'Expert',
    emoji: '🏆',
    description: 'Expert challenge pack',
    requiredToUnlockNext: 0,
    keywords: ['expert', 'pixel', 'pixel-art', 'hard', 'advanced', 'challenge'],
  },
];

export function isValidLevelId(levelId: unknown): levelId is string {
  return typeof levelId === 'string' && GAME_LEVELS.some((level) => level.id === levelId);
}

export function getLevelById(levelId: unknown): GameLevel {
  return GAME_LEVELS.find((level) => level.id === levelId) || GAME_LEVELS[0];
}

export function emptyLevelProgress() {
  const completedImagesByLevel: Record<string, string[]> = {};
  for (const level of GAME_LEVELS) completedImagesByLevel[level.id] = [];
  return {
    completedImagesByLevel,
    unlockedLevelIds: ['beginner'],
    lastCompletedLevelId: null as string | null,
  };
}

export function normalizeLevelProgress(raw: any) {
  const progress = emptyLevelProgress();
  const source = raw && typeof raw === 'object' ? raw : {};
  const byLevel = source.completedImagesByLevel && typeof source.completedImagesByLevel === 'object'
    ? source.completedImagesByLevel
    : {};

  for (const level of GAME_LEVELS) {
    const arr = Array.isArray(byLevel[level.id]) ? byLevel[level.id] : [];
    progress.completedImagesByLevel[level.id] = Array.from(new Set(arr.map((x: any) => String(x)).filter(Boolean)));
  }

  const unlocked = Array.isArray(source.unlockedLevelIds) ? source.unlockedLevelIds : [];
  progress.unlockedLevelIds = Array.from(new Set(['beginner', ...unlocked.map((x: any) => String(x))]))
    .filter((id) => GAME_LEVELS.some((level) => level.id === id));

  progress.lastCompletedLevelId = typeof source.lastCompletedLevelId === 'string' ? source.lastCompletedLevelId : null;
  return calculateUnlockedLevels(progress);
}

export function calculateUnlockedLevels(progress: any) {
  const next = normalizeShallow(progress);

  for (let i = 0; i < GAME_LEVELS.length - 1; i++) {
    const level = GAME_LEVELS[i];
    const nextLevel = GAME_LEVELS[i + 1];
    const completed = new Set(next.completedImagesByLevel[level.id] || []).size;
    if (completed >= level.requiredToUnlockNext && !next.unlockedLevelIds.includes(nextLevel.id)) {
      next.unlockedLevelIds.push(nextLevel.id);
    }
  }

  next.unlockedLevelIds = Array.from(new Set(next.unlockedLevelIds)).filter((id) => GAME_LEVELS.some((level) => level.id === id));
  if (!next.unlockedLevelIds.includes('beginner')) next.unlockedLevelIds.unshift('beginner');
  return next;
}

function normalizeShallow(raw: any) {
  const completedImagesByLevel: Record<string, string[]> = {};
  for (const level of GAME_LEVELS) {
    const arr = Array.isArray(raw?.completedImagesByLevel?.[level.id]) ? raw.completedImagesByLevel[level.id] : [];
    completedImagesByLevel[level.id] = Array.from(new Set(arr.map((x: any) => String(x)).filter(Boolean)));
  }
  const unlocked = Array.isArray(raw?.unlockedLevelIds) ? raw.unlockedLevelIds : ['beginner'];
  return {
    completedImagesByLevel,
    unlockedLevelIds: Array.from(new Set(['beginner', ...unlocked.map((x: any) => String(x))])),
    lastCompletedLevelId: typeof raw?.lastCompletedLevelId === 'string' ? raw.lastCompletedLevelId : null,
  };
}

export function inferImageLevelId(doc: any, index: number, categoryNameById: Map<string, string> = new Map()): string {
  const parts: string[] = [];
  for (const value of [doc?._id, doc?.name, doc?.title]) {
    if (value) parts.push(String(value));
  }

  const categories = Array.isArray(doc?.categories) ? doc.categories : [];
  for (const raw of categories) {
    const id = String(raw?._id ?? raw ?? '').trim();
    if (!id) continue;
    parts.push(id);
    const mapped = categoryNameById.get(id);
    if (mapped) parts.push(mapped);
    if (typeof raw?.name === 'string') parts.push(raw.name);
  }

  const haystack = parts.join(' ').toLowerCase();

  for (const level of GAME_LEVELS) {
    if (level.keywords.some((keyword) => haystack.includes(keyword))) return level.id;
  }

  // Fallback distribution keeps all packs populated even when legacy DB records
  // only have category ids and no difficulty metadata yet.
  return GAME_LEVELS[Math.abs(index) % GAME_LEVELS.length]?.id || 'beginner';
}
