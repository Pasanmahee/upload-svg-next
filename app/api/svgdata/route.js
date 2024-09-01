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
  const selectedCategories = JSON.parse(formData.get('categories'));
  const newCategory = formData.get('newCategory');
  const pngFile = formData.get('pngFile'); // Retrieve the uploaded PNG file if provided

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

  // Modify the SVG content: replace all stroke colors with the specified color from 'colors'
  const strokeColor = colors.stroke || '#000000';
  modifiedSvgData = modifiedSvgData.replace(/stroke\s*=\s*['"][^'"]*['"]/gi, `stroke="${strokeColor}"`);
  modifiedSvgData = modifiedSvgData.replace(/stroke\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi, `stroke:${strokeColor};`);

  // Save the modified SVG back to a buffer for further processing
  const modifiedBuffer = Buffer.from(modifiedSvgData, 'utf8');

  // Save the modified SVG file to the server
  await fs.writeFile(filePath, modifiedBuffer);

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const svgDataCollection = database.collection('svgdata');
    const categoriesCollection = database.collection('categories');

    let newCategoryId = null;
    if (newCategory && newCategory.trim() !== '') {
      const categoryResult = await categoriesCollection.insertOne({ name: newCategory.trim() });
      newCategoryId = categoryResult.insertedId.toString();
      selectedCategories.push(newCategoryId);
    }

    let pngData;
    if (pngFile) {
      const pngBuffer = await pngFile.arrayBuffer();
      pngData = Buffer.from(pngBuffer).toString('base64');
    } else {
      const pngBuffer = await sharp(modifiedBuffer).png().toBuffer();
      pngData = pngBuffer.toString('base64');
    }

    const result = await svgDataCollection.insertOne({
      svgData: originalSvgData,
      colors,
      pngData,
      categories: selectedCategories,
      date: new Date().toISOString(),
    });

    return NextResponse.json({ message: 'Data inserted successfully', result }, { headers });
  } finally {
    await client.close();
    await fs.unlink(filePath);
  }
}

export async function GET(req) {
  const headers = setCORSHeaders();

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

    const data = await collection.findOne({ _id: new ObjectId(id) }, {
      projection: {
        _id: 1,
        svgData: 1,
        colors: 1,
        categories: 1,
        date: 1,
      },
    });

    if (!data) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404, headers });
    }

    return NextResponse.json(data, { headers });
  } finally {
    await client.close();
  }
}
