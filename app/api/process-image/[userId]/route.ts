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

export const runtime = 'nodejs';

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
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

type ImageDataLike = { width: number; height: number; data: Uint8ClampedArray };

export async function POST(request: Request, ctx: { params: { userId: string } }) {
  const userId = decodeURIComponent(ctx.params.userId);

  try {
    const form = await request.formData();
    const image = form.get('image');

    if (!(image instanceof File)) {
      return json({ error: 'No image file found. Use form field name "image".' }, 400);
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
    if (kMeansColorRestrictions) settings.kMeansColorRestrictions = JSON.parse(kMeansColorRestrictions);

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

    // Convert SVG -> PNG via sharp
    const svgBuffer = Buffer.from(svgString, 'utf8');
    const reducedWidth = Math.max(1, Math.floor(imgData.width * 0.9));
    const reducedHeight = Math.max(1, Math.floor(imgData.height * 0.9));

    const pngBuffer = await sharp(svgBuffer)
      .resize(reducedWidth, reducedHeight)
      .png({ compressionLevel: 9, quality: 80 })
      .toBuffer();

    const colors = extractColorPalette(colormapResult.colorsByIndex as any);

    // Upload SVG + PNG to GCS (preferred). If GCS is not configured, fall back to inline data URLs.
    let publicUrlSvg: string | null = null;
    let publicUrlPng: string | null = null;

    const disableGcs = process.env.DISABLE_GCS === '1';
    if (!disableGcs) {
      try {
        const bucketName = getBucketName();
        const storage = getStorage();
        const bucket = storage.bucket(bucketName);

        const randomNumber = Math.floor(Math.random() * 1_000_000);
        const svgFilePath = `svgs/svg-${randomNumber}.svg`;
        const pngFilePath = `images/png-${randomNumber}.png`;

        await bucket.file(svgFilePath).save(svgString, {
          resumable: false,
          metadata: { contentType: 'image/svg+xml' },
        });

        await bucket.file(pngFilePath).save(pngBuffer, {
          resumable: false,
          metadata: { contentType: 'image/png' },
        });

        publicUrlSvg = `https://storage.googleapis.com/${bucketName}/${svgFilePath}`;
        publicUrlPng = `https://storage.googleapis.com/${bucketName}/${pngFilePath}`;
      } catch (e: any) {
        logger.error('GCS upload failed; falling back to inline data URLs', { userId, error: e?.message || e });
      }
    }

    if (!publicUrlSvg || !publicUrlPng) {
      const svgBase64 = Buffer.from(svgString, 'utf8').toString('base64');
      const pngBase64 = pngBuffer.toString('base64');
      publicUrlSvg = `data:image/svg+xml;base64,${svgBase64}`;
      publicUrlPng = `data:image/png;base64,${pngBase64}`;
    }

    // Save record in MongoDB (same collection name as the previous server)
    const mongoUri = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI;
    const canPersist = Boolean(mongoUri) && Boolean(publicUrlSvg) && !publicUrlSvg.startsWith('data:');
    if (!canPersist) {
      return json({
        message: 'Your image was processed successfully!',
        dbRecord: null,
        publicUrlSvg,
        publicUrlPng,
        colors,
      });
    }
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const svgDataCollection = db.collection('svgdata');

    const maxPerUser = Number(process.env.MAX_RECORDS_PER_USER || 3);
    if (Number.isFinite(maxPerUser) && maxPerUser > 0) {
      const recordCount = await svgDataCollection.countDocuments({ userId });
      if (recordCount >= maxPerUser) {
        return json({
          error: `Image limit reached. Max ${maxPerUser} images per user. Delete one and try again.`,
        }, 400);
      }
    }

    const insertRes = await svgDataCollection.insertOne({
      userId,
      svgData: publicUrlSvg,
      pngData: publicUrlPng,
      colors,
      date: new Date().toISOString(),
    });

    logger.log('Image processed successfully', { userId, recordId: insertRes.insertedId.toString() });

    return json({
      message: 'Your image was processed successfully!',
      dbRecord: { _id: insertRes.insertedId, userId, svgData: publicUrlSvg, pngData: publicUrlPng, colors },
      publicUrlSvg,
      publicUrlPng,
      colors,
    });
  } catch (error: any) {
    logger.error('Error processing image', { userId, error: error?.message || error });
    return json({ error: 'An error occurred while processing the image. Please try again later.' }, 500);
  }
}
