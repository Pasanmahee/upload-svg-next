import sharp from 'sharp';

/**
 * Standardise ALL preview / landing-page images on WebP.
 *
 * Why:
 * - WebP usually beats PNG and JPEG on size for web delivery.
 * - Keeps quality high enough for landing pages while hitting KB-level targets via quality+resize.
 */

export type RasterOptimiseOptions = {
  /** Try to get under this size (best-effort). */
  targetKB?: number;
  /** Maximum width/height for output (keeps aspect ratio). */
  maxDim?: number;
  /** Stop downsizing when the largest edge would fall below this. */
  minDim?: number;
  /** Background to flatten against (removes alpha which often saves bytes). */
  background?: string;

  /**
   * Optional hint about source complexity.
   * If small (<=32), we'll attempt lossless WebP earlier (often great for SVG-like line art).
   */
  maxColors?: number;
  minColors?: number;

  // Back-compat: older callers may still pass these (ignored).
  allowJpeg?: boolean;
  preferJpeg?: boolean;
};

export type OptimisedRaster = {
  buffer: Buffer;
  contentType: 'image/webp';
  ext: 'webp';
};

function envIntAny(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function envStrAny(names: string[], fallback: string): string {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim()) return raw;
  }
  return fallback;
}

async function optimiseWebp(input: Buffer, opts: RasterOptimiseOptions = {}): Promise<Buffer> {
  // Keep old env names working (PNG_*) but prefer WEBP_* if set.
  const targetKB = opts.targetKB ?? envIntAny(['WEBP_TARGET_KB', 'PNG_TARGET_KB'], 120);
  const targetBytes = Math.max(1, targetKB) * 1024;

  const maxDim = opts.maxDim ?? envIntAny(['WEBP_MAX_DIM', 'PNG_MAX_DIM'], 1024);
  const minDim = opts.minDim ?? envIntAny(['WEBP_MIN_DIM', 'PNG_MIN_DIM'], 64);
  const background = opts.background ?? envStrAny(['WEBP_BACKGROUND', 'PNG_BACKGROUND'], '#ffffff');

  const hintedMaxColors = Number.isFinite(opts.maxColors as any) ? (opts.maxColors as number) : 0;
  const tryLosslessFirst = hintedMaxColors > 0 && hintedMaxColors <= 32;

  const meta = await sharp(input, { limitInputPixels: false }).metadata();
  const srcW = meta.width ?? maxDim;
  const srcH = meta.height ?? maxDim;

  // Cap to maxDim (without enlargement).
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const baseW = Math.max(1, Math.round(srcW * scale));
  const baseH = Math.max(1, Math.round(srcH * scale));

  // Bounded attempts to keep CPU reasonable.
  const dimScales = [1, 0.9, 0.8, 0.72, 0.64, 0.56, 0.5, 0.44, 0.38, 0.32, 0.28, 0.24, 0.2];
  const qualitySteps = [82, 76, 70, 64, 58, 52, 48, 44, 40, 36, 32, 28, 24, 20];
  const alphaQualitySteps = [90, 80, 70, 60];

  let best: Buffer | null = null;

  for (const s of dimScales) {
    const w = Math.max(1, Math.round(baseW * s));
    const h = Math.max(1, Math.round(baseH * s));
    if (Math.max(w, h) < minDim) break;

    // Line-art/flat colors often compress extremely well in lossless WebP.
    if (tryLosslessFirst) {
      const outLossless = await sharp(input, { limitInputPixels: false })
        .rotate()
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background })
        .webp({ lossless: true, effort: 6 })
        .toBuffer();

      if (!best || outLossless.length < best.length) best = outLossless;
      if (outLossless.length <= targetBytes) return outLossless;
    }

    // Lossy WebP: quality is the main lever; resizing is the second lever.
    for (const alphaQuality of alphaQualitySteps) {
      for (const quality of qualitySteps) {
        const out = await sharp(input, { limitInputPixels: false })
          .rotate()
          .resize(w, h, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background })
          .webp({
            quality,
            alphaQuality,
            smartSubsample: true,
            effort: 6,
          })
          .toBuffer();

        if (!best || out.length < best.length) best = out;
        if (out.length <= targetBytes) return out;
      }
    }
  }

  return best ?? input;
}

/**
 * Best-effort raster optimisation (WebP only).
 */
export async function optimiseRaster(input: Buffer, opts: RasterOptimiseOptions = {}): Promise<OptimisedRaster> {
  const webp = await optimiseWebp(input, opts);
  return { buffer: webp, contentType: 'image/webp', ext: 'webp' };
}
