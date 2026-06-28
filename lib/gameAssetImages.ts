/* eslint-disable @typescript-eslint/no-explicit-any */
import sharp from 'sharp';

export type OptimisedGameAsset = {
  buffer: Buffer;
  contentType: 'image/webp';
  ext: 'webp';
  width: number;
  height: number;
};

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Optimise admin/game-setting icons as small transparent WebP files.
 * This keeps transparency for icons, converts every input to WebP, and tries to hit
 * a small target size by reducing quality and dimensions in bounded attempts.
 */
export async function optimiseGameAssetImage(input: Buffer, opts: { targetKB?: number; maxDim?: number; minDim?: number } = {}): Promise<OptimisedGameAsset> {
  const targetKB = opts.targetKB ?? envInt('GAME_ASSET_TARGET_KB', 28);
  const targetBytes = Math.max(4, targetKB) * 1024;
  const maxDim = opts.maxDim ?? envInt('GAME_ASSET_MAX_DIM', 512);
  const minDim = opts.minDim ?? envInt('GAME_ASSET_MIN_DIM', 96);

  const meta = await sharp(input, { limitInputPixels: false }).metadata();
  const srcW = meta.width || maxDim;
  const srcH = meta.height || maxDim;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const baseW = Math.max(1, Math.round(srcW * scale));
  const baseH = Math.max(1, Math.round(srcH * scale));

  const dimScales = [1, 0.9, 0.8, 0.72, 0.64, 0.56, 0.5, 0.44, 0.38, 0.32, 0.28, 0.24];
  const qualitySteps = [86, 80, 74, 68, 62, 56, 50, 44, 38, 32, 28, 24, 20];
  const alphaQualitySteps = [90, 80, 70, 60, 50, 40];

  let best: { buffer: Buffer; width: number; height: number } | null = null;

  for (const s of dimScales) {
    const w = Math.max(1, Math.round(baseW * s));
    const h = Math.max(1, Math.round(baseH * s));
    if (Math.max(w, h) < minDim) break;

    // Try lossless first for flat icons. Keep it only if it already fits.
    try {
      const lossless = await sharp(input, { limitInputPixels: false })
        .rotate()
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .webp({ lossless: true, effort: 6 })
        .toBuffer();
      if (!best || lossless.length < best.buffer.length) best = { buffer: lossless, width: w, height: h };
      if (lossless.length <= targetBytes) {
        return { buffer: lossless, contentType: 'image/webp', ext: 'webp', width: w, height: h };
      }
    } catch {
      // fall back to lossy attempts below
    }

    for (const alphaQuality of alphaQualitySteps) {
      for (const quality of qualitySteps) {
        const out = await sharp(input, { limitInputPixels: false })
          .rotate()
          .resize(w, h, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality, alphaQuality, smartSubsample: true, effort: 6 })
          .toBuffer();

        if (!best || out.length < best.buffer.length) best = { buffer: out, width: w, height: h };
        if (out.length <= targetBytes) {
          return { buffer: out, contentType: 'image/webp', ext: 'webp', width: w, height: h };
        }
      }
    }
  }

  if (!best) {
    const fallback = await sharp(input, { limitInputPixels: false })
      .rotate()
      .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72, alphaQuality: 80, effort: 6, smartSubsample: true })
      .toBuffer();
    return { buffer: fallback, contentType: 'image/webp', ext: 'webp', width: baseW, height: baseH };
  }

  return { buffer: best.buffer, contentType: 'image/webp', ext: 'webp', width: best.width, height: best.height };
}

export function safeAssetPurpose(value: unknown): string {
  const s = String(value || 'game-asset')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (s || 'game-asset').slice(0, 64);
}
