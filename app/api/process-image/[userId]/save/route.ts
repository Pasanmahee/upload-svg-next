import { logger } from '@/lib/logger';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage, resolveGcsReadUrl } from '@/lib/gcs';
import { verifyFirebaseAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Authorization',
      ...corsHeaders,
    },
  });
}

function parseJson<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeName(value: FormDataEntryValue | null, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[\\/\0]/g, '-').slice(0, 180);
  return cleaned || fallback;
}

function extFromContentType(contentType: string): 'webp' | 'png' | 'jpg' {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'webp';
}

export async function POST(request: Request, ctx: { params: Promise<{ userId: string }> }) {
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
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const userId = auth.uid;
  if (requestedUserId !== userId) {
    logger.log('browser process draft userId mismatch; using authenticated uid', {
      requestedUserId,
      authenticatedUid: userId,
      provider: auth.provider,
    });
  }

  try {
    const form = await request.formData();
    const svg = form.get('svg');
    const preview = form.get('preview');

    if (!(svg instanceof File) || svg.type !== 'image/svg+xml') {
      return json({ error: 'Missing generated SVG file in form field "svg".' }, 400);
    }
    if (!(preview instanceof File) || !preview.type.startsWith('image/')) {
      return json({ error: 'Missing generated preview image in form field "preview".' }, 400);
    }

    const maxSvgBytes = 12 * 1024 * 1024;
    const maxPreviewBytes = 8 * 1024 * 1024;
    if (svg.size > maxSvgBytes) {
      return json({ error: 'Generated SVG is too large to save. Reduce image dimensions or facet count.' }, 413);
    }
    if (preview.size > maxPreviewBytes) {
      return json({ error: 'Generated preview is too large to save.' }, 413);
    }

    const colorsRaw = parseJson<unknown>(form.get('colors'), []);
    const colors = Array.isArray(colorsRaw)
      ? colorsRaw.filter((value): value is string => typeof value === 'string').slice(0, 256)
      : [];
    const processOptions = parseJson<Record<string, unknown>>(form.get('processOptions'), {});
    const originalFileName = safeName(form.get('originalFileName'), 'processed-image');

    const svgBuffer = Buffer.from(await svg.arrayBuffer());
    const previewBuffer = Buffer.from(await preview.arrayBuffer());
    const previewContentType = preview.type || 'image/webp';
    const previewExt = extFromContentType(previewContentType);

    const svgInlineDataUrl = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
    const previewInlineDataUrl = `data:${previewContentType};base64,${previewBuffer.toString('base64')}`;

    const approxBytes =
      Buffer.byteLength(svgInlineDataUrl, 'utf8') +
      Buffer.byteLength(previewInlineDataUrl, 'utf8') +
      Buffer.byteLength(JSON.stringify(colors), 'utf8') +
      Buffer.byteLength(JSON.stringify(processOptions), 'utf8');
    if (approxBytes > 14 * 1024 * 1024) {
      return json(
        { error: 'Generated draft is too large for MongoDB. Reduce image dimensions or facet count.' },
        413,
      );
    }

    let gcsUrlSvg: string | null = null;
    let gcsUrlPng: string | null = null;
    if (process.env.DISABLE_GCS !== '1') {
      try {
        const bucketName = getBucketName();
        const storage = getStorage();
        const bucket = storage.bucket(bucketName);
        const id = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        const svgFilePath = `svgs/browser-${id}.svg`;
        const previewFilePath = `images/browser-preview-${id}.${previewExt}`;

        await Promise.all([
          bucket.file(svgFilePath).save(svgBuffer, {
            resumable: false,
            metadata: { contentType: 'image/svg+xml' },
          }),
          bucket.file(previewFilePath).save(previewBuffer, {
            resumable: false,
            metadata: { contentType: previewContentType },
          }),
        ]);

        gcsUrlSvg = `https://storage.googleapis.com/${bucketName}/${svgFilePath}`;
        gcsUrlPng = `https://storage.googleapis.com/${bucketName}/${previewFilePath}`;
      } catch (error: any) {
        logger.error('Browser-generated draft GCS upload failed; inline draft remains available', {
          userId,
          error: error?.message || error,
        });
      }
    }

    if (!process.env.MONGODB_URI) {
      const origin = new URL(request.url).origin;
      const responseSvg = gcsUrlSvg ? await resolveGcsReadUrl(gcsUrlSvg, origin) : null;
      const responsePng = gcsUrlPng ? await resolveGcsReadUrl(gcsUrlPng, origin) : null;
      return json({
        message: 'Image processed in the browser. MongoDB is not configured, so the draft was not saved.',
        draftOnly: true,
        draftId: null,
        uploadSvgUrl: null,
        gcsUrlSvg: responseSvg,
        gcsUrlPng: responsePng,
        previewContentType,
        previewExt,
        colors,
        processOptions,
        warning: 'MONGODB_URI is not configured. Download the generated files manually.',
      });
    }

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const draftRes = await db.collection('processDrafts').insertOne({
      userId,
      originalFileName,
      svgData: gcsUrlSvg || svgInlineDataUrl,
      pngData: gcsUrlPng || previewInlineDataUrl,
      svgInlineData: svgInlineDataUrl,
      pngInlineData: previewInlineDataUrl,
      previewContentType,
      previewExt,
      colors,
      processOptions: {
        ...processOptions,
        processingLocation: 'browser',
      },
      generator: 'svg-generator-browser',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const draftId = draftRes.insertedId.toString();
    logger.log('Browser-generated image draft saved', { userId, draftId, svgBytes: svg.size, previewBytes: preview.size });
    const origin = new URL(request.url).origin;
    const responseSvg = gcsUrlSvg ? await resolveGcsReadUrl(gcsUrlSvg, origin) : null;
    const responsePng = gcsUrlPng ? await resolveGcsReadUrl(gcsUrlPng, origin) : null;

    return json({
      message: 'Image processed in the browser and saved as an upload draft.',
      draftOnly: true,
      draftId,
      uploadSvgUrl: `/upload-svg?draftId=${draftId}`,
      dbRecord: null,
      recordId: null,
      gcsUrlSvg: responseSvg,
      gcsUrlPng: responsePng,
      previewContentType,
      previewExt,
      colors,
      processOptions: {
        ...processOptions,
        processingLocation: 'browser',
      },
    });
  } catch (error: any) {
    logger.error('Failed to save browser-generated image draft', {
      userId,
      error: error?.message || error,
    });
    return json(
      {
        error: 'The image was processed in the browser, but the generated draft could not be saved.',
        details: error?.message ? String(error.message) : String(error || 'Unknown error'),
        stage: 'saving browser-generated draft',
      },
      500,
    );
  }
}
