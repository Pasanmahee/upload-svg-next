import { MongoClient } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

export function getMongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI (server env var).');
  }

  if (!global.__mongoClientPromise) {
    const client = new MongoClient(uri);
    global.__mongoClientPromise = client.connect();
  }

  return global.__mongoClientPromise;
}

export function getDbName(): string {
  return process.env.MONGODB_DB_NAME || process.env.DB_NAME || 'myDatabase';
}
