import sharp from 'sharp';
import settingsJson from '@/settings.json';
import { logger } from '@/lib/logger';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage } from '@/lib/gcs';
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

type ImageDataLike = { width: number; height: number; data: Uint8ClampedArray };

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

  try {
    const form = await request.formData();
    const image = form.get('image');

    if (!(image instanceof File)) {
      return json({ error: 'No image file found. Use form field name "image".' }, 400);
    }

    // Enforce per-user limit BEFORE heavy processing (Sharp + clustering + SVG/PNG generation).
    // This prevents spending CPU/time when the user already reached MAX_RECORDS_PER_USER.
    const canPersist = Boolean(process.env.MONGODB_URI);


    // Default stays at 3 if env is missing (same as previous behavior).
    const maxPerUser = Number.parseInt(process.env.MAX_RECORDS_PER_USER || '3', 10);
    let svgDataCollection: any = null;

    if (canPersist) {
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

    const svgSizeMultiplier = Number(form.get('svgSizeMultiplier')?.toString() || 3);

    const buf = Buffer.from(await image.arrayBuffer());

    // Decode & optionally resize image with sharp (no canvas dependency)
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

    await ColorReducer.applyKMeansClustering(
      imgData as any,
      kmeansImgData as any,
      {} as any,
      settings as any,
      null,
    );

    const colormapResult = ColorReducer.createColorMap(kmeansImgData as any);

    let facetResult = await FacetCreator.getFacets(imgData.width, imgData.height, colormapResult.imgColorIndices);

    await FacetReducer.reduceFacets(
      settings.removeFacetsSmallerThanNrOfPoints,
      settings.removeFacetsFromLargeToSmall,
      settings.maximumNumberOfFacets,
      colormapResult.colorsByIndex,
      facetResult,
      colormapResult.imgColorIndices,
    );

    await FacetBorderTracer.buildFacetBorderPaths(facetResult);
    await FacetBorderSegmenter.buildFacetBorderSegments(facetResult, settings.nrOfTimesToHalveBorderSegments);
    await FacetLabelPlacer.buildFacetLabelBounds(facetResult);

    const svgString = await createSVG(
      facetResult,
      colormapResult.colorsByIndex,
      {
        sizeMultiplier: svgSizeMultiplier,
        fillFacets: true,
        showBorders: true,
        showLabels: true,
        fontSize: 60,
        fontColor: 'black',
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

    const raster = await optimiseRaster(svgBuffer, {
      maxDim: previewMaxDim,
      maxColors: approxPalette,
      background: '#ffffff',
    });

    const previewBuffer = raster.buffer;
    const previewContentType = raster.contentType;
    const previewExt = raster.ext;

    const colors = extractColorPalette(colormapResult.colorsByIndex as any);

    // Upload SVG + PNG to GCS (preferred). If GCS is not configured, fall back to inline data URLs.
    let publicUrlSvg: string | null = null;
    let publicUrlPng: string | null = null; // kept for backward compatibility (now stores WebP)

    const disableGcs = process.env.DISABLE_GCS === '1';
    if (!disableGcs) {
      try {
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
      const svgBase64 = Buffer.from(svgString, 'utf8').toString('base64');
      const pngBase64 = previewBuffer.toString('base64');
      publicUrlSvg = `data:image/svg+xml;base64,${svgBase64}`;
      publicUrlPng = `data:${previewContentType};base64,${pngBase64}`;
    }

    // Save record in MongoDB.
    // IMPORTANT: Do NOT require GCS URLs here.
    // In your logs, GCS may fail (billing disabled) and we fall back to data URLs.
    // If we don't persist those, the client will navigate to /home?id=<recordId>
    // but the record won't exist -> /api/svgdata?id=... returns 404.
    if (!canPersist) {
      return json({
        message: 'Your image was processed successfully!',
        dbRecord: null,
        recordId: null,
        publicUrlSvg,
        publicUrlPng,
        previewContentType,
        previewExt,
        colors,
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

    const insertRes = await svgDataCollection.insertOne({
      userId,
      svgData: publicUrlSvg,
      pngData: publicUrlPng,
      colors,
      date: new Date().toISOString(),
    });

    const recordId = insertRes.insertedId.toString();
    logger.log('Image processed successfully', { userId, recordId });

    return json({
      message: 'Your image was processed successfully!',
      recordId,
      dbRecord: { _id: insertRes.insertedId, userId, svgData: publicUrlSvg, pngData: publicUrlPng, colors },
      publicUrlSvg,
      publicUrlPng,
      previewContentType,
      previewExt,
      colors,
    });
  } catch (error: any) {
    logger.error('Error processing image', { userId, error: error?.message || error });
    return json({ error: 'An error occurred while processing the image. Please try again later.' }, 500);
  }
}