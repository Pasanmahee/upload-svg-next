import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function POST(req) {
  const headers = setCORSHeaders();

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return NextResponse.json({}, { status: 200, headers });
  }

  const formData = await req.formData();
  const file = formData.get('file');
  const colors = JSON.parse(formData.get('colors'));

  if (!file || !colors) {
    return NextResponse.json({ message: 'File or colors missing' }, { status: 400, headers });
  }

  const filePath = join(process.cwd(), 'uploads', file.name);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Ensure the uploads directory exists
  await fs.mkdir(join(process.cwd(), 'uploads'), { recursive: true });

  // Convert buffer to a string to get the original SVG content
  const originalSvgData = buffer.toString('utf8');

  // Modify the SVG content: replace all fill colors with white (#FFFFFF)
  let modifiedSvgData = originalSvgData.replace(/fill\s*=\s*['"][^'"]*['"]/gi, 'fill="#FFFFFF"');
  modifiedSvgData = modifiedSvgData.replace(/fill\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi, 'fill:#FFFFFF;');

  // Save the modified SVG back to a buffer for further processing
  const modifiedBuffer = Buffer.from(modifiedSvgData, 'utf8');

  // Save the modified SVG file to the server
  await fs.writeFile(filePath, modifiedBuffer);

  try {
    // Convert modified SVG to PNG using sharp
    const pngBuffer = await sharp(modifiedBuffer)
      .png()
      .toBuffer();

    // Convert the PNG buffer to a base64 string
    const pngData = pngBuffer.toString('base64');

    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // Insert original SVG data and modified PNG data
    const result = await collection.insertOne({ svgData: originalSvgData, colors, pngData });
    return NextResponse.json({ message: 'Data inserted successfully', result }, { headers });
  } finally {
    await client.close();

    // Optionally delete the uploaded file after processing
    await fs.unlink(filePath);
  }
}

export async function GET(req) {
  const headers = setCORSHeaders();

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return NextResponse.json({}, { status: 200, headers });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ message: 'ID is required' }, { status: 400, headers });
  }

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    const data = await collection.findOne({ _id: new ObjectId(id) });

    if (!data) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404, headers });
    }

    return NextResponse.json(data, { headers });
  } finally {
    await client.close();
  }
}
