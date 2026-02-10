import { MongoClient } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

export function getMongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
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
  // Keep database name consistent across ALL routes.
  // Prefer MONGODB_DB (common) then MONGODB_DB_NAME (alt), then DB_NAME.
  // Default matches the DB you showed in MongoDB Compass: svgfacetpaintbynumber.
  return (
    process.env.MONGODB_DB ||
    process.env.MONGODB_DB_NAME ||
    process.env.DB_NAME ||
    'svgfacetpaintbynumber'
  );
}
