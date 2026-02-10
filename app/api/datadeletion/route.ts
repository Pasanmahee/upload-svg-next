/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';

export const runtime = 'nodejs';

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Email',
  };
}

function isValidEmail(email: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// OPTIONS handler for CORS preflight
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { headers });
}

// NOTE: Kept as GET to avoid breaking existing clients.
// This endpoint records a deletion request.
export async function GET(req: Request) {
  const headers = setCORSHeaders();

  try {
    // Extract the email from the query parameters
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required', status: 'failed' }, { status: 400, headers });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email format', status: 'failed' }, { status: 400, headers });
    }

    // Use shared/cached Mongo client (no per-request connect/close)
    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('dataDeletionRequests');

    // Check if the email already exists in the database
    const existingRequest = await collection.findOne({ email });

    if (existingRequest) {
      return NextResponse.json(
        {
          message: 'A deletion request for this email already exists.',
          status: (existingRequest as any).status,
          requestId: (existingRequest as any)._id,
        },
        { headers }
      );
    }

    // Insert a new deletion request record with a timestamp
    const deletionRequest = {
      email,
      requestedAt: new Date(),
      status: 'pending',
    };

    const result = await collection.insertOne(deletionRequest);

    return NextResponse.json(
      {
        message: 'Data deletion request recorded successfully',
        requestId: result.insertedId,
        status: 'pending',
      },
      { headers }
    );
  } catch (error) {
    console.error('Error recording data deletion request:', error);
    return NextResponse.json({ error: 'Internal server error', status: 'failed' }, { status: 500, headers });
  }
}
