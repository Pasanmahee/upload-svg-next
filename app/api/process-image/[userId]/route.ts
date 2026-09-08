import sharp from 'sharp';
import settingsJson from '@/settings.json';
import { logger } from '@/lib/logger';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage, resolveGcsReadUrl } from '@/lib/gcs';
import { ColorReducer } from '@/lib/pbn/colorreductionmanagement';
import { FacetCreator } from '@/lib/pbn/facetCreator';
import { FacetReducer } from '@/lib/pbn/facetReducer';
import { FacetBorderTracer } from '@/lib/pbn/facetBorderTracer';
import { FacetBorderSegmenter } from '@/lib/pbn/facetBorderSegmenter';
import { FacetLabelPlacer } from '@/lib/pbn/facetLabelPlacer';
import { createSVG, extractColorPalette } from '@/lib/pbnSvg';
import { verifyFirebaseAuth } from '@/lib/auth';
import { optimiseRaster } from '@/lib/imageOptimiser';

export const runtime = 'nodejs';
// Image vectorization can take longer than a normal API request.
// This prevents Vercel from returning a plain-text platform error before our JSON catch block.
export const maxDuration = 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    // Prevent intermediary caching across users.
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Authorization',
      ...corsHeaders,
    },
  });
}

function isDebugRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const debug = url.searchParams.get('debug');
    return debug === '1' || debug === 'true';
  } catch {
    return false;
  }
}

function safeErrorDetails(error: any): { details: string; code?: string; name?: string; stack?: string } {
  const details = error?.message ? String(error.message) : String(error || 'Unknown error');
  const out: { details: string; code?: string; name?: string; stack?: string } = { details };
  if (error?.code) out.code = String(error.code);
  if (error?.name) out.name = String(error.name);
  if (error?.stack) out.stack = String(error.stack).split('\\n').slice(0, 8).join('\\n');
  return out;
}

type ImageDataLike = { width: number; height: number; data: Uint8ClampedArray };

function optionalNumber(form: FormData, key: string): number | null {
  const raw = form.get(key)?.toString();
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function optionalBoolean(form: FormData, key: string): boolean | null {
  const raw = form.get(key)?.toString();
  if (raw == null || raw === '') return null;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return null;
}

function optionalString(form: FormData, key: string): string | null {
  const raw = form.get(key)?.toString();
  return raw == null || raw === '' ? null : raw;
}

// Next.js 15+ passes params as a Promise ("Dynamic APIs are Asynchronous").
// Unwrap with await before reading properties.
export async function POST(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  // Be tolerant to Next.js versions that pass params either as an object or a Promise.
  const params = await Promise.resolve((ctx as any)?.params);
  const rawUserId = (params as any)?.userId;
  if (typeof rawUserId !== 'string' || !rawUserId) {
    return json({ error: 'Missing userId in URL.' }, 400);
  }

  let requestedUserId: string;
  try {
    requestedUserId = decodeURIComponent(rawUserId);
  } catch {
    return json({ error: 'Invalid userId encoding in URL.' }, 400);
  }

  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Use the verified Firebase/admin UID as the owner.
  // Older app builds sometimes pass a legacy/local userId in the URL while the
  // Authorization header belongs to the silent Firebase anonymous user. That
  // caused a 403 Forbidden even though the token was valid. Do not trust the
  // URL userId for ownership; keep it only for legacy route compatibility.
  const userId = auth.uid;
  if (requestedUserId !== userId) {
    logger.log('process-image userId mismatch; using authenticated uid', {
      requestedUserId,
      authenticatedUid: userId,
      provider: auth.provider,
      isAnonymous: !!auth.isAnonymous,
    });
  }

  let stage = 'starting';
  let includeDebugDetails = isDebugRequest(request) || process.env.NODE_ENV !== 'production';

  try {
    stage = 'reading request form';
    const form = await request.formData();
    const debugForm = optionalBoolean(form, 'debug');
    if (debugForm != null) includeDebugDetails = includeDebugDetails || debugForm;
    const image = form.get('image');

    if (!(image instanceof File)) {
      return json({ error: 'No image file found. Use form field name "image".' }, 400);
    }

    // Backend/admin processing should create a draft, not a My Works item.
    // Mobile/app clients that do not send draftOnly keep the old persist-to-svgdata behavior.
    const draftOnly = optionalBoolean(form, 'draftOnly') ?? false;
    const originalFileName = typeof image.name === 'string' && image.name ? image.name : 'processed-image';

    // Enforce per-user limit BEFORE heavy processing (Sharp + clustering + SVG/PNG generation).
    // This prevents spending CPU/time when the user already reached MAX_RECORDS_PER_USER.
    const canPersist = Boolean(process.env.MONGODB_URI);


    // Default stays at 3 if env is missing (same as previous behavior).
    const maxPerUser = Number.parseInt(process.env.MAX_RECORDS_PER_USER || '3', 10);
    let svgDataCollection: any = null;

    stage = 'checking MongoDB user image limit';
    if (canPersist && !draftOnly) {
      const client = await getMongoClient();
      const db = client.db(getDbName());
      svgDataCollection = db.collection('svgdata');

      if (Number.isFinite(maxPerUser) && maxPerUser > 0) {
        const recordCount = await svgDataCollection.countDocuments({ userId });
        if (recordCount >= maxPerUser) {
          return json(
            {
              error: `Image limit reached. Max ${maxPerUser} images per user. Delete one and try again.`,
              limit: maxPerUser,
              current: recordCount,
            },
            429
          );
        }
      }
    }

    stage = 'parsing processing settings';
    // Clone base settings + apply any overrides from the request
    const settings: any = { ...(settingsJson as any) };

    const kMeansNrOfClusters = form.get('kMeansNrOfClusters')?.toString();
    const kMeansMinDeltaDifference = form.get('kMeansMinDeltaDifference')?.toString();
    const kMeansClusteringColorSpace = form.get('kMeansClusteringColorSpace')?.toString();
    const kMeansColorRestrictions = form.get('kMeansColorRestrictions')?.toString();

    if (kMeansNrOfClusters) settings.kMeansNrOfClusters = parseInt(kMeansNrOfClusters, 10);
    if (kMeansMinDeltaDifference) settings.kMeansMinDeltaDifference = parseFloat(kMeansMinDeltaDifference);
    if (kMeansClusteringColorSpace) settings.kMeansClusteringColorSpace = parseInt(kMeansClusteringColorSpace, 10);
    if (kMeansColorRestrictions) {
      try {
        settings.kMeansColorRestrictions = JSON.parse(kMeansColorRestrictions);
      } catch {
        return json({ error: 'Invalid kMeansColorRestrictions JSON.' }, 400);
      }
    }

    const maximumNumberOfFacets = form.get('maximumNumberOfFacets')?.toString();
    if (maximumNumberOfFacets) settings.maximumNumberOfFacets = parseInt(maximumNumberOfFacets, 10);

    const removeSmall = optionalNumber(form, 'removeFacetsSmallerThanNrOfPoints');
    if (removeSmall != null) settings.removeFacetsSmallerThanNrOfPoints = Math.max(1, Math.floor(removeSmall));

    const removeLargeFirst = optionalBoolean(form, 'removeFacetsFromLargeToSmall');
    if (removeLargeFirst != null) settings.removeFacetsFromLargeToSmall = removeLargeFirst;

    const narrowRuns = optionalNumber(form, 'narrowPixelStripCleanupRuns');
    if (narrowRuns != null) settings.narrowPixelStripCleanupRuns = Math.max(0, Math.min(10, Math.floor(narrowRuns)));

    const borderHalves = optionalNumber(form, 'nrOfTimesToHalveBorderSegments');
    if (borderHalves != null) settings.nrOfTimesToHalveBorderSegments = Math.max(0, Math.min(8, Math.floor(borderHalves)));

    const speckleEnabled = optionalBoolean(form, 'speckleCleanupEnabled');
    if (speckleEnabled != null) settings.speckleCleanupEnabled = speckleEnabled;

    const speckleRadius = optionalNumber(form, 'speckleCleanupRadius');
    if (speckleRadius != null) settings.speckleCleanupRadius = Math.max(0, Math.min(3, Math.floor(speckleRadius)));

    const specklePasses = optionalNumber(form, 'speckleCleanupPasses');
    if (specklePasses != null) settings.speckleCleanupPasses = Math.max(0, Math.min(5, Math.floor(specklePasses)));

    const resizeWidth = optionalNumber(form, 'resizeImageWidth');
    if (resizeWidth != null) settings.resizeImageWidth = Math.max(64, Math.floor(resizeWidth));

    const resizeHeight = optionalNumber(form, 'resizeImageHeight');
    if (resizeHeight != null) settings.resizeImageHeight = Math.max(64, Math.floor(resizeHeight));

    const resizeIfTooLarge = optionalBoolean(form, 'resizeImageIfTooLarge');
    if (resizeIfTooLarge != null) settings.resizeImageIfTooLarge = resizeIfTooLarge;

    const svgSizeMultiplier = Number(form.get('svgSizeMultiplier')?.toString() || 3);
    const svgFontSize = optionalNumber(form, 'svgFontSize') ?? 50;
    const svgFontColor = optionalString(form, 'svgFontColor') ?? '#000';
    const svgCurveMode = optionalString(form, 'svgCurveMode') || settings.svgCurveMode || 'cubic_catmull';

    // Output/SVG generation settings ported from the uploaded browser generator UI.
    const showLabels = optionalBoolean(form, 'showLabels') ?? true;
    const fillFacets = optionalBoolean(form, 'fillFacets') ?? true;
    const showBorders = optionalBoolean(form, 'showBorders') ?? true;
    const geometryMode = optionalString(form, 'geometryMode') || 'facets';
    const geometry = {
      mode: geometryMode,
      cellSize: optionalNumber(form, 'geoCellSize') ?? 32,
      jitter: optionalNumber(form, 'geoJitter') ?? 0.35,
      edgeStrength: optionalNumber(form, 'geoEdgeStrength') ?? 0.35,
      useSourceColor: optionalBoolean(form, 'geoUseSourceColor') ?? true,
    };
    const artisticPreset = optionalString(form, 'artisticPreset') || 'classic';

    if (geometryMode !== 'facets') {
      return json(
        {
          error: 'This backend build currently supports Facets (paint-by-number) output only.',
          stage: 'validating SVG generation settings',
          details: `Selected geometryMode=${geometryMode}. Choose Facets (paint-by-number), or add the geometric SVG renderer before using low-poly/grid modes.`,
        },
        400,
      );
    }

    const artistic = {
      borderSimplifyEpsilon: optionalNumber(form, 'borderSimplifyEpsilon') ?? settings.borderSimplifyEpsilon ?? 0,
      strokeColorMode: optionalString(form, 'strokeColorMode') ?? settings.strokeColorMode ?? 'ink',
      innerStrokeWidth: optionalNumber(form, 'innerStrokeWidth') ?? settings.innerStrokeWidth ?? 1,
      outerStrokeWidth: optionalNumber(form, 'outerStrokeWidth') ?? settings.outerStrokeWidth ?? settings.innerStrokeWidth ?? 1,
      strokeOpacity: optionalNumber(form, 'strokeOpacity') ?? settings.strokeOpacity ?? 1,
      nonScalingStroke: optionalBoolean(form, 'nonScalingStroke') ?? settings.nonScalingStroke ?? false,
      paintOrderStrokeFill: optionalBoolean(form, 'paintOrderStrokeFill') ?? settings.paintOrderStrokeFill ?? true,
      labelHalo: optionalBoolean(form, 'labelHalo') ?? settings.labelHalo ?? true,
    };

    stage = 'reading uploaded image bytes';
    const buf = Buffer.from(await image.arrayBuffer());

    // Decode & optionally resize image with sharp (no canvas dependency)
    stage = 'decoding image metadata with Sharp';
    let pipeline = sharp(buf).rotate();
    const meta = await pipeline.metadata();

    if (
      settings.resizeImageIfTooLarge &&
      meta.width &&
      meta.height &&
      (meta.width > settings.resizeImageWidth || meta.height > settings.resizeImageHeight)
    ) {
      pipeline = pipeline.resize({
        width: settings.resizeImageWidth,
        height: settings.resizeImageHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });
      logger.log(`Resizing input image (was ${meta.width}x${meta.height}) to fit within ${settings.resizeImageWidth}x${settings.resizeImageHeight}`);
    }

    stage = 'converting image to raw RGBA pixels';
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const imgData: ImageDataLike = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data),
    };

    const kmeansImgData: ImageDataLike = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(info.width * info.height * 4),
    };

    logger.log('Running k-means clustering', { userId, w: info.width, h: info.height, k: settings.kMeansNrOfClusters });

    stage = 'running k-means color clustering';
    await ColorReducer.applyKMeansClustering(
      imgData as any,
      kmeansImgData as any,
      {} as any,
      settings as any,
      null,
    );

    stage = 'creating color map';
    const colormapResult = ColorReducer.createColorMap(kmeansImgData as any);

    if (settings.speckleCleanupEnabled && settings.speckleCleanupRadius > 0 && settings.speckleCleanupPasses > 0) {
      logger.log('Running speckle cleanup', {
        userId,
        radius: settings.speckleCleanupRadius,
        passes: settings.speckleCleanupPasses,
      });
      stage = 'running speckle cleanup';
      await ColorReducer.processSpeckleCleanup(
        colormapResult as any,
        settings.speckleCleanupRadius,
        settings.speckleCleanupPasses,
      );
    }

    let facetResult: any = null;
    const cleanupRuns = Math.max(0, Math.floor(settings.narrowPixelStripCleanupRuns || 0));
    const buildAndReduceFacets = async () => {
      stage = 'creating facets';
      const nextFacetResult = await FacetCreator.getFacets(imgData.width, imgData.height, colormapResult.imgColorIndices);
      stage = 'reducing facets';
      await FacetReducer.reduceFacets(
        settings.removeFacetsSmallerThanNrOfPoints,
        settings.removeFacetsFromLargeToSmall,
        settings.maximumNumberOfFacets,
        colormapResult.colorsByIndex,
        nextFacetResult,
        colormapResult.imgColorIndices,
      );
      return nextFacetResult;
    };

    if (cleanupRuns === 0) {
      facetResult = await buildAndReduceFacets();
    } else {
      for (let run = 0; run < cleanupRuns; run++) {
        logger.log('Running narrow pixel strip cleanup', { userId, run: run + 1, cleanupRuns });
        stage = `running narrow pixel strip cleanup ${run + 1}/${cleanupRuns}`;
        await ColorReducer.processNarrowPixelStripCleanup(colormapResult as any);
        facetResult = await buildAndReduceFacets();
      }
    }

    stage = 'building facet border paths';
    await FacetBorderTracer.buildFacetBorderPaths(facetResult);
    stage = 'building facet border segments';
    await FacetBorderSegmenter.buildFacetBorderSegments(facetResult, settings.nrOfTimesToHalveBorderSegments);
    stage = 'placing labels';
    await FacetLabelPlacer.buildFacetLabelBounds(facetResult);

    stage = 'creating SVG output';
    const svgString = await createSVG(
      facetResult,
      colormapResult.colorsByIndex,
      {
        sizeMultiplier: svgSizeMultiplier,
        fillFacets,
        showBorders,
        showLabels,
        fontSize: svgFontSize,
        fontColor: svgFontColor,
        curveMode: svgCurveMode,
        artistic,
      },
      null,
    );

    // Convert SVG -> aggressively optimised WebP (best for landing-page load speed)
    const svgBuffer = Buffer.from(svgString, 'utf8');
    const reducedWidth = Math.max(1, Math.floor(imgData.width * 0.9));
    const reducedHeight = Math.max(1, Math.floor(imgData.height * 0.9));

    // Keep previews reasonably small even if SVG multiplier is large.
    const envMaxDim = Number.parseInt(process.env.WEBP_MAX_DIM || process.env.PNG_MAX_DIM || '1024', 10) || 1024;
    const previewMaxDim = Math.min(envMaxDim, Math.max(reducedWidth, reducedHeight));

    // Paint-by-number output has limited distinct colors (k clusters + borders + labels).
    const approxPalette = Math.max(32, Math.min(128, (colormapResult.colorsByIndex?.length || 0) + 24));

    stage = 'creating preview raster';
    const raster = await optimiseRaster(svgBuffer, {
      maxDim: previewMaxDim,
      maxColors: approxPalette,
      background: '#ffffff',
    });

    const previewBuffer = raster.buffer;
    const previewContentType = raster.contentType;
    const previewExt = raster.ext;

    const colors = extractColorPalette(colormapResult.colorsByIndex as any);

    // Always keep inline draft copies for the admin Process Image → Upload SVG flow.
    // GCS URLs can exist but still be private/403 in some deployments, so draft loading
    // must not depend on public bucket access.
    const svgInlineDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgString, 'utf8').toString('base64')}`;
    const previewInlineDataUrl = `data:${previewContentType};base64,${previewBuffer.toString('base64')}`;

    // Upload SVG + PNG to GCS (preferred). If GCS is not configured, fall back to inline data URLs.
    let publicUrlSvg: string | null = null;
    let publicUrlPng: string | null = null; // kept for backward compatibility (now stores WebP)

    const disableGcs = process.env.DISABLE_GCS === '1';
    if (!disableGcs) {
      try {
        stage = 'uploading processed assets to GCS';
        const bucketName = getBucketName();
        const storage = getStorage();
        const bucket = storage.bucket(bucketName);

        const randomNumber = Math.floor(Math.random() * 1_000_000);
        const svgFilePath = `svgs/svg-${randomNumber}.svg`;
        const pngFilePath = `images/preview-${randomNumber}.${previewExt}`;

        await bucket.file(svgFilePath).save(svgString, {
          resumable: false,
          metadata: { contentType: 'image/svg+xml' },
        });

        await bucket.file(pngFilePath).save(previewBuffer, {
          resumable: false,
          metadata: { contentType: previewContentType },
        });

        publicUrlSvg = `https://storage.googleapis.com/${bucketName}/${svgFilePath}`;
        publicUrlPng = `https://storage.googleapis.com/${bucketName}/${pngFilePath}`;
      } catch (e: any) {
        logger.error('GCS upload failed; falling back to inline data URLs', { userId, error: e?.message || e });
      }
    }

    if (!publicUrlSvg || !publicUrlPng) {
      publicUrlSvg = svgInlineDataUrl;
      publicUrlPng = previewInlineDataUrl;
    }

    const processOptions = {
      randomSeed: settings.randomSeed,
      kMeansNrOfClusters: settings.kMeansNrOfClusters,
      kMeansMinDeltaDifference: settings.kMeansMinDeltaDifference,
      kMeansClusteringColorSpace: settings.kMeansClusteringColorSpace,
      speckleCleanupEnabled: !!settings.speckleCleanupEnabled,
      speckleCleanupRadius: settings.speckleCleanupRadius,
      speckleCleanupPasses: settings.speckleCleanupPasses,
      narrowPixelStripCleanupRuns: settings.narrowPixelStripCleanupRuns,
      removeFacetsSmallerThanNrOfPoints: settings.removeFacetsSmallerThanNrOfPoints,
      maximumNumberOfFacets: settings.maximumNumberOfFacets,
      nrOfTimesToHalveBorderSegments: settings.nrOfTimesToHalveBorderSegments,
      svgCurveMode,
      svgSizeMultiplier,
      svgFontSize,
      svgFontColor,
      showLabels,
      fillFacets,
      showBorders,
      geometry,
      artisticPreset,
      artistic,
    };

    // Backend/admin processing creates a draft that can be loaded into /upload-svg.
    // This avoids polluting the mobile app's My Works list before the admin intentionally uploads it.
    if (draftOnly) {
      let draftId: string | null = null;
      if (canPersist) {
        stage = 'saving processed draft to MongoDB';
        const client = await getMongoClient();
        const db = client.db(getDbName());
        const draftRes = await db.collection('processDrafts').insertOne({
          userId,
          originalFileName,
          svgData: publicUrlSvg,
          pngData: publicUrlPng,
          // Inline copies are the source of truth for loading drafts into Upload SVG.
          // They avoid 403 errors when GCS objects are not public.
          svgInlineData: svgInlineDataUrl,
          pngInlineData: previewInlineDataUrl,
          previewContentType,
          previewExt,
          colors,
          processOptions,
          generator: 'svg-generator-backend-port',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        draftId = draftRes.insertedId.toString();
      }

      const origin = new URL(request.url).origin;
      const storedGcsSvg = publicUrlSvg && !publicUrlSvg.startsWith('data:') ? publicUrlSvg : null;
      const storedGcsPng = publicUrlPng && !publicUrlPng.startsWith('data:') ? publicUrlPng : null;
      const readableGcsSvg = storedGcsSvg ? await resolveGcsReadUrl(storedGcsSvg, origin) : null;
      const readableGcsPng = storedGcsPng ? await resolveGcsReadUrl(storedGcsPng, origin) : null;

      return json({
        message: 'Image processed as an upload draft. It was not added to My Works.',
        draftOnly: true,
        draftId,
        uploadSvgUrl: draftId ? `/upload-svg?draftId=${draftId}` : null,
        dbRecord: null,
        recordId: null,
        // Do not expose private storage.googleapis.com objects as the admin
        // preview/open links. Private buckets return AccessDenied for anonymous
        // callers. Inline data URLs are safe for immediate admin preview and
        // download, while GCS URLs remain internal draft metadata.
        publicUrlSvg: svgInlineDataUrl,
        publicUrlPng: previewInlineDataUrl,
        svgDataUrl: svgInlineDataUrl,
        previewDataUrl: previewInlineDataUrl,
        gcsUrlSvg: readableGcsSvg,
        gcsUrlPng: readableGcsPng,
        previewContentType,
        previewExt,
        colors,
        processOptions,
        warning: canPersist ? undefined : 'MONGODB_URI is not configured; use the SVG/preview links manually.',
      });
    }

    // Save record in MongoDB for app/mobile clients that still expect /home?id=<recordId>.
    // IMPORTANT: Do NOT require GCS URLs here.
    // In your logs, GCS may fail (billing disabled) and we fall back to data URLs.
    // If we don't persist those, the client will navigate to /home?id=<recordId>
    // but the record won't exist -> /api/svgdata?id=... returns 404.
    if (!canPersist) {
      const origin = new URL(request.url).origin;
      const responseSvg = await resolveGcsReadUrl(publicUrlSvg, origin);
      const responsePng = await resolveGcsReadUrl(publicUrlPng, origin);
      return json({
        message: 'Your image was processed successfully!',
        dbRecord: null,
        recordId: null,
        publicUrlSvg: responseSvg,
        publicUrlPng: responsePng,
        previewContentType,
        previewExt,
        colors,
        processOptions,
        warning: 'MONGODB_URI is not configured; result was not saved.',
      });
    }

    // Guard: MongoDB document limit is 16MB. If we are using inline data URLs,
    // keep a little safety margin.
    const approxBytes =
      Buffer.byteLength(publicUrlSvg ?? '', 'utf8') +
      Buffer.byteLength(publicUrlPng ?? '', 'utf8') +
      Buffer.byteLength(JSON.stringify(colors ?? []), 'utf8');
    const maxBytes = 14 * 1024 * 1024;
    if (approxBytes > maxBytes) {
      return json(
        {
          error:
            'Processed result is too large to store inline. Enable GCS storage or reduce image size / facets.',
          approxBytes,
        },
        413,
      );
    }
    // Reuse the collection opened for the early-limit check.
    // If, for any reason, it wasn't opened (shouldn't happen when canPersist=true),
    // open it here as a fallback.
    if (!svgDataCollection) {
      const client = await getMongoClient();
      const db = client.db(getDbName());
      svgDataCollection = db.collection('svgdata');
    }

    // Final guard in case another request inserted while this one was processing.
    if (Number.isFinite(maxPerUser) && maxPerUser > 0) {
      const recordCount = await svgDataCollection.countDocuments({ userId });
      if (recordCount >= maxPerUser) {
        return json(
          { error: `Image limit reached. Max ${maxPerUser} images per user. Delete one and try again.` },
          429,
        );
      }
    }

    stage = 'saving processed record to MongoDB';
    const insertRes = await svgDataCollection.insertOne({
      userId,
      svgData: publicUrlSvg,
      pngData: publicUrlPng,
      colors,
      processOptions,
      generator: 'svg-generator-backend-port',
      date: new Date().toISOString(),
    });

    const recordId = insertRes.insertedId.toString();
    logger.log('Image processed successfully', { userId, recordId });
    const origin = new URL(request.url).origin;
    const responseSvg = await resolveGcsReadUrl(publicUrlSvg, origin);
    const responsePng = await resolveGcsReadUrl(publicUrlPng, origin);

    return json({
      message: 'Your image was processed successfully!',
      recordId,
      dbRecord: { _id: insertRes.insertedId, userId, svgData: responseSvg, pngData: responsePng, colors },
      publicUrlSvg: responseSvg,
      publicUrlPng: responsePng,
      previewContentType,
      previewExt,
      colors,
      processOptions,
    });
  } catch (error: any) {
    logger.error('Error processing image', { userId, stage, error: error?.message || error });
    const debug = safeErrorDetails(error);
    return json(
      {
        error: 'An error occurred while processing the image. Please try again later.',
        stage,
        ...(includeDebugDetails ? debug : {}),
      },
      500,
    );
  }
}
