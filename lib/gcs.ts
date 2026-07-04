import { Storage } from '@google-cloud/storage';

let storageSingleton: Storage | null = null;

export type GcsObjectRef = { bucket: string; objectPath: string };

function getServiceAccountFromEnv(): any | null {
  const b64 = process.env.GCP_SA_KEY_B64;
  if (!b64) return null;
  try {
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export function getStorage(): Storage {
  if (storageSingleton) return storageSingleton;

  // Preferred order:
  // 1) GCP_SA_KEY_B64 with base64 encoded service-account JSON
  // 2) GOOGLE_APPLICATION_CREDENTIALS pointing to a mounted JSON file
  // 3) Application Default Credentials from the runtime environment
  const sa = getServiceAccountFromEnv();
  if (sa?.client_email && sa?.private_key) {
    storageSingleton = new Storage({
      projectId: sa.project_id,
      credentials: {
        client_email: sa.client_email,
        private_key: sa.private_key,
      },
    });
  } else {
    storageSingleton = new Storage();
  }

  return storageSingleton;
}

export function getBucketName(): string {
  // Support both names because older configs used GCS_BUCKET.
  return process.env.GCS_BUCKET_NAME || process.env.GCS_BUCKET || 'svg-image-processing-bucket';
}

/**
 * Accepts:
 * - gs://<bucket>/<object>
 * - https://storage.googleapis.com/<bucket>/<object>
 * - https://<bucket>.storage.googleapis.com/<object>
 * - <object> path only, using the configured default bucket
 *
 * Returns null for data URLs and non-GCS http(s) URLs so routes can keep those
 * values unchanged instead of failing during module import/startup.
 */
export function parseGcsObjectRef(value: string): GcsObjectRef | null {
  if (!value) return null;
  if (value.startsWith('data:')) return null;

  const noQuery = value.split('?')[0];

  if (noQuery.startsWith('gs://')) {
    const rest = noQuery.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash <= 0) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  if (noQuery.startsWith('http://') || noQuery.startsWith('https://')) {
    try {
      const url = new URL(noQuery);

      if (url.hostname === 'storage.googleapis.com') {
        const [, bucket, ...objectParts] = url.pathname.split('/');
        const objectPath = objectParts.join('/');
        if (!bucket || !objectPath) return null;
        return { bucket, objectPath };
      }

      if (url.hostname.endsWith('.storage.googleapis.com')) {
        const bucket = url.hostname.slice(0, -'.storage.googleapis.com'.length);
        const objectPath = url.pathname.replace(/^\/+/, '');
        if (!bucket || !objectPath) return null;
        return { bucket, objectPath };
      }

      return null;
    } catch {
      return null;
    }
  }

  if (noQuery.includes('://')) return null;

  const objectPath = noQuery.replace(/^\/+/, '');
  if (!objectPath) return null;
  return { bucket: getBucketName(), objectPath };
}

export async function signGcsReadUrl(maybeUrlOrPath: string, ttlMs = 15 * 60 * 1000): Promise<string> {
  const target = parseGcsObjectRef(maybeUrlOrPath);
  if (!target) return maybeUrlOrPath;

  const [signedUrl] = await getStorage()
    .bucket(target.bucket)
    .file(target.objectPath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlMs,
    });

  return signedUrl;
}
