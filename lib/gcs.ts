import { Storage } from '@google-cloud/storage';

let storageSingleton: Storage | null = null;

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

  // Preferred:
  // 1) GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON file
  // 2) Otherwise, use Application Default Credentials (e.g., `gcloud auth application-default login`)
  // 3) If provided, GCP_SA_KEY_B64 can supply a service account JSON without writing to disk
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
  return (
    process.env.GCS_BUCKET_NAME ||
    process.env.GCS_BUCKET ||
    'svg-image-processing-bucket'
  );
}
