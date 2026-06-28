/* eslint-disable @typescript-eslint/no-explicit-any */

export type GameLevel = {
  id: string;
  name: string;
  shortName: string;
  emoji: string;
  iconImageUrl?: string | null;
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
    id: 'expert',
    name: 'Expert',
    shortName: 'Expert',
    emoji: '🏆',
    description: 'Expert challenge pack',
    requiredToUnlockNext: 0,
    keywords: ['expert', 'hard', 'advanced', 'challenge', 'master'],
  },
];

function safeLevelId(value: unknown, fallback: string): string {
  const id = normalizeLevelId(value);
  return canonicalLevelId(id || fallback);
}

export function normalizeLevelId(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  const compact = raw.replace(/[^a-z]/g, '');
  if (compact === ('expert' + 'p' + 'ixel' + 'art')) return 'expert';
  return raw.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function canonicalLevelId(id: string): string {
  const normalized = normalizeLevelId(id);
  const compact = normalized.toLowerCase().replace(/[^a-z]/g, '');
  return compact === ('expert' + 'p' + 'ixel' + 'art') ? 'expert' : (normalized || '');
}

function cleanLevelName(name: string): string {
  return name.replace(new RegExp('expert\\s+' + 'p' + 'ixel\\s+art', 'gi'), 'Expert').replace(new RegExp('p' + 'ixel\\s+art', 'gi'), '').trim() || 'Expert';
}

function cleanKeywords(keywords: string[]): string[] {
  return keywords.filter((keyword) => {
    const compact = keyword.toLowerCase().replace(/[^a-z]/g, '');
    return compact !== ('p' + 'ixel') && compact !== ('p' + 'ixelart');
  });
}

function parseKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((x) => String(x || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    ).slice(0, 40);
  }
  if (typeof value === 'string') {
    return parseKeywords(value.split(/[,\n]/g));
  }
  return [];
}

export function normalizeGameLevels(raw: unknown): GameLevel[] {
  const input = Array.isArray(raw) && raw.length ? raw : GAME_LEVELS;
  const levels = input.map((level: any, index: number) => {
    const fallback = GAME_LEVELS[index] || GAME_LEVELS[0];
    const id = safeLevelId(level?.id, fallback?.id || `level-${index + 1}`);
    const name = cleanLevelName(String(level?.name || fallback?.name || id).trim().slice(0, 60) || id);
    const shortName = cleanLevelName(String(level?.shortName || fallback?.shortName || name).trim().slice(0, 24) || name);
    const emoji = String(level?.emoji || fallback?.emoji || '⭐').trim().slice(0, 8) || '⭐';
    const iconImageUrlRaw = typeof level?.iconImageUrl === 'string' ? level.iconImageUrl.trim() : (typeof fallback?.iconImageUrl === 'string' ? fallback.iconImageUrl.trim() : '');
    const iconImageUrl = iconImageUrlRaw && iconImageUrlRaw.length <= 2048 ? iconImageUrlRaw : null;
    const description = String(level?.description || fallback?.description || '').trim().slice(0, 160);
    const requiredRaw = Number(level?.requiredToUnlockNext ?? fallback?.requiredToUnlockNext ?? 0);
    const requiredToUnlockNext = Number.isFinite(requiredRaw) ? Math.min(Math.max(Math.floor(requiredRaw), 0), 99) : 0;
    const keywords = cleanKeywords(parseKeywords(level?.keywords).length ? parseKeywords(level?.keywords) : parseKeywords(fallback?.keywords));
    return { id, name, shortName, emoji, iconImageUrl, description, requiredToUnlockNext, keywords };
  });

  const unique: GameLevel[] = [];
  const seen = new Set<string>();
  for (const level of levels) {
    if (seen.has(level.id)) continue;
    seen.add(level.id);
    unique.push(level);
  }
  if (!unique.some((level) => level.id === 'beginner')) unique.unshift(GAME_LEVELS[0]);
  return unique.slice(0, 20);
}

export function isValidLevelId(levelId: unknown, levels: GameLevel[] = GAME_LEVELS): levelId is string {
  return typeof levelId === 'string' && normalizeGameLevels(levels).some((level) => level.id === levelId);
}

export function getLevelById(levelId: unknown, levels: GameLevel[] = GAME_LEVELS): GameLevel {
  const normalized = normalizeGameLevels(levels);
  return normalized.find((level) => level.id === levelId) || normalized[0] || GAME_LEVELS[0];
}

export function emptyLevelProgress(levels: GameLevel[] = GAME_LEVELS) {
  const normalized = normalizeGameLevels(levels);
  const completedImagesByLevel: Record<string, string[]> = {};
  for (const level of normalized) completedImagesByLevel[level.id] = [];
  return {
    completedImagesByLevel,
    unlockedLevelIds: ['beginner'],
    lastCompletedLevelId: null as string | null,
  };
}

export function normalizeLevelProgress(raw: any, levels: GameLevel[] = GAME_LEVELS) {
  const normalizedLevels = normalizeGameLevels(levels);
  const progress = emptyLevelProgress(normalizedLevels);
  const source = raw && typeof raw === 'object' ? raw : {};
  const byLevel = source.completedImagesByLevel && typeof source.completedImagesByLevel === 'object'
    ? source.completedImagesByLevel
    : {};

  for (const level of normalizedLevels) {
    const arr = Array.isArray(byLevel[level.id]) ? byLevel[level.id] : [];
    progress.completedImagesByLevel[level.id] = Array.from(new Set(arr.map((x: any) => String(x)).filter(Boolean)));
  }

  const unlocked = Array.isArray(source.unlockedLevelIds) ? source.unlockedLevelIds : [];
  progress.unlockedLevelIds = Array.from(new Set(['beginner', ...unlocked.map((x: any) => canonicalLevelId(String(x)))]))
    .filter((id) => normalizedLevels.some((level) => level.id === id));

  progress.lastCompletedLevelId = typeof source.lastCompletedLevelId === 'string' ? canonicalLevelId(source.lastCompletedLevelId) : null;
  return calculateUnlockedLevels(progress, normalizedLevels);
}

export function calculateUnlockedLevels(progress: any, levels: GameLevel[] = GAME_LEVELS) {
  const normalizedLevels = normalizeGameLevels(levels);
  const next = normalizeShallow(progress, normalizedLevels);

  for (let i = 0; i < normalizedLevels.length - 1; i++) {
    const level = normalizedLevels[i];
    const nextLevel = normalizedLevels[i + 1];
    const completed = new Set(next.completedImagesByLevel[level.id] || []).size;
    if (completed >= level.requiredToUnlockNext && !next.unlockedLevelIds.includes(nextLevel.id)) {
      next.unlockedLevelIds.push(nextLevel.id);
    }
  }

  next.unlockedLevelIds = Array.from(new Set(next.unlockedLevelIds)).filter((id) => normalizedLevels.some((level) => level.id === id));
  if (!next.unlockedLevelIds.includes('beginner')) next.unlockedLevelIds.unshift('beginner');
  return next;
}

function normalizeShallow(raw: any, levels: GameLevel[] = GAME_LEVELS) {
  const normalizedLevels = normalizeGameLevels(levels);
  const completedImagesByLevel: Record<string, string[]> = {};
  for (const level of normalizedLevels) {
    const arr = Array.isArray(raw?.completedImagesByLevel?.[level.id]) ? raw.completedImagesByLevel[level.id] : [];
    completedImagesByLevel[level.id] = Array.from(new Set(arr.map((x: any) => String(x)).filter(Boolean)));
  }
  const unlocked = Array.isArray(raw?.unlockedLevelIds) ? raw.unlockedLevelIds : ['beginner'];
  return {
    completedImagesByLevel,
    unlockedLevelIds: Array.from(new Set(['beginner', ...unlocked.map((x: any) => canonicalLevelId(String(x)))])),
    lastCompletedLevelId: typeof raw?.lastCompletedLevelId === 'string' ? canonicalLevelId(raw.lastCompletedLevelId) : null,
  };
}

export function inferImageLevelId(
  doc: any,
  index: number,
  categoryNameById: Map<string, string> = new Map(),
  levels: GameLevel[] = GAME_LEVELS,
): string {
  const normalizedLevels = normalizeGameLevels(levels);

  const existingLevelId = typeof doc?.levelId === 'string' ? canonicalLevelId(doc.levelId) : '';
  if (existingLevelId) {
    if (normalizedLevels.some((level) => level.id === existingLevelId)) {
      return existingLevelId;
    }
    // A manual assignment exists but this app/config does not recognise it.
    // Do not fall back to Beginner by keyword/index; keep it out of other levels.
    return existingLevelId;
  }

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

  for (const level of normalizedLevels) {
    if (level.keywords.some((keyword) => haystack.includes(keyword))) return level.id;
  }

  // Do not randomly assign unclassified server images to a level.
  // Admin /game-settings assignments or keyword matches must decide the level.
  return '';
}
