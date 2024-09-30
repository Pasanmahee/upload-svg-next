import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const uri = process.env.NEXT_PUBLIC_MONGODB_URI;
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
  const imageFile = formData.get('imageFile'); // Retrieve the uploaded PNG or JPG file if provided

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

  // Google Cloud Storage setup
  const bucketName = 'svg-image-processing-bucket';  // Replace with your actual bucket name
  const storage = new Storage();

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

    // Generate a random number (or use a more unique identifier like a UUID)
    const randomNumber = Math.floor(Math.random() * 1000000); // Generates a random number between 0 and 999999

    // Update the cloudFilePath to include the random number
    const cloudFilePath = `svgs/${file.name}-${randomNumber}`;

    // Upload original SVG data to Google Cloud Storage
    const bucket = storage.bucket(bucketName);
    const fileInBucket = bucket.file(cloudFilePath);

    // Save the originalSvgData to the bucket
    await fileInBucket.save(originalSvgData, {
      resumable: false,
      metadata: {
        contentType: 'image/svg+xml',
      },
    });

    // Save the URL of the SVG in Google Cloud Storage
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${cloudFilePath}`;

    let imageData;
    if (imageFile) {
      const imageBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(imageBuffer);

      const imageFormat = imageFile.type === 'image/jpeg' ? 'jpeg' : 'png';

      // Reduce the size of the uploaded image file dynamically
      const { width, height } = await sharp(buffer).metadata();
      const reducedWidth = Math.floor(width * 0.9);  // Dynamically reduce width by 30%
      const reducedHeight = Math.floor(height * 0.9);  // Dynamically reduce height by 30%

      const resizedImageBuffer = await sharp(buffer)
        .resize(reducedWidth, reducedHeight)  // Resize to reduced resolution
      [imageFormat]({ quality: 80 })  // Compress and adjust quality
        .toBuffer();

      imageData = resizedImageBuffer.toString('base64');
    } else {
      // Generate a PNG from the modified SVG with resizing and compression
      const { width, height } = await sharp(modifiedBuffer).metadata();
      const reducedWidth = Math.floor(width * 0.9);  // Dynamically reduce width by 30%
      const reducedHeight = Math.floor(height * 0.9);  // Dynamically reduce height by 30%

      const pngBuffer = await sharp(modifiedBuffer)
        .resize(reducedWidth, reducedHeight)  // Resize to reduced resolution
        .png({ compressionLevel: 9, quality: 80 })  // Compress and adjust quality
        .toBuffer();

      imageData = pngBuffer.toString('base64');
    }

    const result = await svgDataCollection.insertOne({
      svgData: publicUrl,  // Save the URL instead of raw SVG data
      colors,
      pngData: imageData,
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
        svgData: 1,  // Public URL stored in svgData field
        colors: 1,
        categories: 1,
        date: 1,
      },
    });

    if (!data || !data.svgData) {
      return NextResponse.json({ message: 'Document not found or SVG data missing' }, { status: 404, headers });
    }

    // Fetch the raw SVG data from the public URL
    const response = await fetch(data.svgData);
    if (!response.ok) {
      return NextResponse.json({ message: 'Failed to fetch SVG data' }, { status: 500, headers });
    }

    const rawSvgData = await response.text();

    // Prepare the response object with metadata and raw SVG data
    const responseData = {
      _id: data._id,
      colors: data.colors,
      categories: data.categories,
      date: data.date,
      svgData: rawSvgData,  // Raw SVG content
    };

    // Send the response data as JSON
    return NextResponse.json(responseData, { headers });
  } finally {
    await client.close();
  }
}
