import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { Storage } from '@google-cloud/storage';

const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
const client = new MongoClient(uri);

// Set up Google Cloud Storage
const storage = new Storage();
const bucketName = 'svg-image-processing-bucket'; // Name of your Google Cloud bucket
const bucket = storage.bucket(bucketName);

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function DELETE(req) {
  const headers = setCORSHeaders();

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return NextResponse.json({}, { status: 200, headers });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const recordId = searchParams.get('recordId');

  if (!userId || !recordId) {
    return NextResponse.json({ error: 'userId and recordId are required' }, { status: 400, headers });
  }

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // Ensure valid ObjectId for recordId
    const objectId = new ObjectId(recordId);

    // Fetch the document to get the file path before deleting the record
    const document = await collection.findOne({ _id: objectId, userId });

    if (!document) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404, headers });
    }

    // Delete the file from Google Cloud Storage
    const cloudFilePath = document.svgData.replace(`https://storage.googleapis.com/${bucketName}/`, '');

    const file = bucket.file(cloudFilePath);
    await file.delete();
    console.log(`File ${cloudFilePath} deleted from Google Cloud Storage`);

    // Delete the record from MongoDB
    const result = await collection.deleteOne({ _id: objectId, userId: userId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Record not found in database' }, { status: 404, headers });
    }

    return NextResponse.json({ message: 'Record and file deleted successfully' }, { status: 200, headers });
  } catch (error) {
    console.error('Error deleting record or file:', error);
    return NextResponse.json({ error: 'Failed to delete record or file' }, { status: 500, headers });
  } finally {
    await client.close();
  }
}
