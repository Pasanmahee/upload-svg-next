import { Storage } from '@google-cloud/storage';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

let storageSingleton: Storage | null = null;

export type GcsObjectRef = { bucket: string; objectPath: string };

type ServiceAccountLike = {
  project_id?: string;
  projectId?: string;
  client_email?: string;
  clientEmail?: string;
  private_key?: string;
  privateKey?: string;
};

type NormalizedServiceAccount = {
  projectId?: string;
  clientEmail: string;
  privateKey: string;
};

function normalizePrivateKey(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : '';
}

function normalizeServiceAccount(value: unknown): NormalizedServiceAccount | null {
  if (!value || typeof value !== 'object') return null;
  const sa = value as ServiceAccountLike;
  const clientEmail = sa.client_email || sa.clientEmail || '';
  const privateKey = normalizePrivateKey(sa.private_key || sa.privateKey);
  const projectId = sa.project_id || sa.projectId || undefined;

  if (!clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function parseJsonServiceAccount(raw: string | undefined): NormalizedServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    return normalizeServiceAccount(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseBase64ServiceAccount(raw: string | undefined): NormalizedServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return normalizeServiceAccount(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function readServiceAccountFile(path: string | undefined): NormalizedServiceAccount | null {
  if (!path?.trim()) return null;
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return parseJsonServiceAccount(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Resolve a Google service account without depending on a filesystem path.
 *
 * Preferred GCS vars are checked first. Firebase Admin service-account vars are
 * accepted as a fallback because many deployments already provide the same
 * Google service account there. GOOGLE_APPLICATION_CREDENTIALS is used only if
 * the referenced file actually exists.
 */
function getServiceAccountFromEnv(): NormalizedServiceAccount | null {
  const jsonCandidates = [
    process.env.GCP_SA_KEY_JSON,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    process.env.FIREBASE_ADMIN_SA_JSON,
  ];
  for (const candidate of jsonCandidates) {
    const parsed = parseJsonServiceAccount(candidate);
    if (parsed) return parsed;
  }

  const b64Candidates = [
    process.env.GCP_SA_KEY_B64,
    process.env.GOOGLE_SERVICE_ACCOUNT_B64,
    process.env.FIREBASE_SERVICE_ACCOUNT_B64,
    process.env.FIREBASE_ADMIN_SA_B64,
  ];
  for (const candidate of b64Candidates) {
    const parsed = parseBase64ServiceAccount(candidate);
    if (parsed) return parsed;
  }

  const direct = normalizeServiceAccount({
    project_id: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY,
  });
  if (direct) return direct;

  return readServiceAccountFile(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function clearBrokenGoogleCredentialsPath(): void {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialPath) return;

  try {
    if (existsSync(credentialPath) && statSync(credentialPath).isFile()) return;
  } catch {
    // Treat unreadable/broken paths the same as missing paths.
  }

  console.warn(
    `[GCS] Ignoring GOOGLE_APPLICATION_CREDENTIALS because the file does not exist: ${credentialPath}. ` +
      'For Vercel/Docker, prefer GCP_SA_KEY_B64 or GCP_SA_KEY_JSON.',
  );

  // google-auth-library reads this variable lazily. Leaving a broken path in
  // process.env causes every signed URL/download attempt to fail with ENOENT.
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

export function getStorage(): Storage {
  if (storageSingleton) return storageSingleton;

  const sa = getServiceAccountFromEnv();
  if (sa) {
    storageSingleton = new Storage({
      projectId: sa.projectId || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
      credentials: {
        client_email: sa.clientEmail,
        private_key: sa.privateKey,
      },
    });
    return storageSingleton;
  }

  clearBrokenGoogleCredentialsPath();

  // Last fallback: Application Default Credentials. This works on Google Cloud
  // runtimes or developer machines configured with ADC. On Vercel, provide a
  // service account via one of the env vars handled above.
  storageSingleton = new Storage({
    projectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
  });
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

function getProxySecret(): string | null {
  return (
    process.env.GCS_PROXY_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.GCP_SA_KEY_B64 ||
    process.env.FIREBASE_SERVICE_ACCOUNT_B64 ||
    process.env.FIREBASE_ADMIN_SA_B64 ||
    null
  );
}

export function createGcsProxyUrl(
  maybeUrlOrPath: string,
  origin: string,
  ttlMs = 15 * 60 * 1000,
): string | null {
  const target = parseGcsObjectRef(maybeUrlOrPath);
  const secret = getProxySecret();
  if (!target || !secret || !origin) return null;

  const exp = Math.floor((Date.now() + ttlMs) / 1000);
  const ref = Buffer.from(JSON.stringify(target), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(`${ref}.${exp}`).digest('base64url');
  return `${origin.replace(/\/$/, '')}/api/gcs-file?ref=${encodeURIComponent(ref)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

export function verifyGcsProxyToken(ref: string, expRaw: string, sig: string): GcsObjectRef | null {
  const secret = getProxySecret();
  const exp = Number.parseInt(expRaw, 10);
  if (!secret || !ref || !sig || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  const expected = createHmac('sha256', secret).update(`${ref}.${exp}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(ref, 'base64url').toString('utf8')) as GcsObjectRef;
    if (!parsed?.bucket || !parsed?.objectPath) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function resolveGcsReadUrl(
  maybeUrlOrPath: unknown,
  origin: string,
  ttlMs = 15 * 60 * 1000,
): Promise<unknown> {
  if (typeof maybeUrlOrPath !== 'string' || !maybeUrlOrPath) return maybeUrlOrPath;
  const target = parseGcsObjectRef(maybeUrlOrPath);
  if (!target) return maybeUrlOrPath;

  try {
    return await signGcsReadUrl(maybeUrlOrPath, ttlMs);
  } catch (error) {
    const proxyUrl = createGcsProxyUrl(maybeUrlOrPath, origin, ttlMs);
    if (proxyUrl) {
      console.warn('GCS signed URL generation failed; using authenticated server proxy.', error);
      return proxyUrl;
    }
    throw error;
  }
}
