// app/api/data-deletion/route.js
import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
const client = new MongoClient(uri);

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// OPTIONS handler for CORS preflight
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req) {
  const headers = setCORSHeaders();
  
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400, headers });
    }

    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('dataDeletionRequests');

    // Insert a new deletion request record with a timestamp
    const deletionRequest = {
      email,
      requestedAt: new Date(),
      status: 'pending', // You can track the status of the deletion request
    };

    const result = await collection.insertOne(deletionRequest);

    return NextResponse.json({
      message: 'Data deletion request recorded successfully',
      requestId: result.insertedId,
    }, { headers });
  } catch (error) {
    console.error('Error recording data deletion request:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers });
  } finally {
    await client.close();
  }
}
