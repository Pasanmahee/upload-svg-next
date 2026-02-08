import { Storage } from '@google-cloud/storage';

let storageSingleton: Storage | null = null;

export function getStorage(): Storage {
  if (storageSingleton) return storageSingleton;

  // If GOOGLE_APPLICATION_CREDENTIALS is set, the Google SDK will use it automatically.
  // Otherwise it will try Application Default Credentials.
  storageSingleton = new Storage();
  return storageSingleton;
}

export function getBucketName(): string {
  return process.env.GCS_BUCKET_NAME || 'svg-image-processing-bucket';
}
