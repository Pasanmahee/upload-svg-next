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

// Handle preflight requests
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req) {
  const headers = setCORSHeaders();

  const formData = await req.formData();
  const file = formData.get('file');
  const colors = JSON.parse(formData.get('colors'));
  const selectedCategories = JSON.parse(formData.get('categories'));
  const newCategory = formData.get('newCategory');
  const imageFile = formData.get('imageFile'); // Retrieve the uploaded PNG or JPG file if provided
  const hasSimplifiedSvgParam = formData.get('hasSimplifiedSvg');

  // Convert the string value ("true"/"false") to a boolean
  const hasSimplifiedSvg = hasSimplifiedSvgParam === 'true';

  if (!file || !colors) {
    return NextResponse.json(
      { message: 'File or colors missing' },
      { status: 400, headers }
    );
  }

  const filePath = join(process.cwd(), 'uploads', file.name);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Ensure the uploads directory exists
  await fs.mkdir(join(process.cwd(), 'uploads'), { recursive: true });

  // Convert buffer to a string to get the original SVG content
  const originalSvgData = buffer.toString('utf8');

  // Modify the SVG content: replace all fill colors with white (#FFFFFF)
  let modifiedSvgData = originalSvgData.replace(
    /fill\s*=\s*['"][^'"]*['"]/gi,
    'fill="#FFFFFF"'
  );
  modifiedSvgData = modifiedSvgData.replace(
    /fill\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi,
    'fill:#FFFFFF;'
  );

  // Modify the SVG content: replace all stroke colors with the specified color from 'colors'
  const strokeColor = colors.stroke || '#000000';
  modifiedSvgData = modifiedSvgData.replace(
    /stroke\s*=\s*['"][^'"]*['"]/gi,
    `stroke="${strokeColor}"`
  );
  modifiedSvgData = modifiedSvgData.replace(
    /stroke\s*:\s*rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\);/gi,
    `stroke:${strokeColor};`
  );

  // Save the modified SVG back to a buffer for further processing
  const modifiedBuffer = Buffer.from(modifiedSvgData, 'utf8');

  // Save the modified SVG file to the server
  await fs.writeFile(filePath, modifiedBuffer);

  // Google Cloud Storage setup
  const bucketName = 'svg-image-processing-bucket'; // Replace with your actual bucket name
  const storage = new Storage();

  // Generate a random number for unique file naming
  const randomNumber = Math.floor(Math.random() * 1_000_000);

  // We’ll store the SVG in: svgs/<fileName>-<randomNumber>.svg
  const svgFileName = `svgs/${file.name}-${randomNumber}.svg`;

  // We’ll store the PNG (or final image) in: images/<fileName>-<randomNumber>.png (or .jpeg)
  // For clarity, extract the extension from imageFile if present
  let imageFileExtension = 'png';
  if (imageFile && imageFile.type === 'image/jpeg') {
    imageFileExtension = 'jpeg';
  }
  const imageFileName = `images/${file.name}-${randomNumber}.${imageFileExtension}`;

  try {
    // ---------------------
    //   Connect to Mongo
    // ---------------------
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const svgDataCollection = database.collection('svgdata');
    const categoriesCollection = database.collection('categories');

    // ---------------------
    //   Insert newCategory if provided
    // ---------------------
    let newCategoryId = null;
    if (newCategory && newCategory.trim() !== '') {
      const categoryResult = await categoriesCollection.insertOne({
        name: newCategory.trim(),
      });
      newCategoryId = categoryResult.insertedId.toString();
      selectedCategories.push(newCategoryId);
    }

    // ---------------------
    //   Upload Original SVG to GCS
    // ---------------------
    const bucket = storage.bucket(bucketName);
    const fileInBucket = bucket.file(svgFileName);

    await fileInBucket.save(originalSvgData, {
      resumable: false,
      metadata: {
        contentType: 'image/svg+xml',
      },
    });

    // Generate a public URL for the SVG
    const publicUrlSVG = `https://storage.googleapis.com/${bucketName}/${svgFileName}`;

    // ---------------------
    //   Prepare & Upload PNG (or user image) to GCS
    // ---------------------
    let resizedImageBuffer;
    if (imageFile) {
      // Use the uploaded PNG/JPG file instead
      const imageArrayBuffer = await imageFile.arrayBuffer();
      const rawImageBuffer = Buffer.from(imageArrayBuffer);

      const { width, height } = await sharp(rawImageBuffer).metadata();
      const reducedWidth = Math.floor(width * 0.9);
      const reducedHeight = Math.floor(height * 0.9);

      resizedImageBuffer = await sharp(rawImageBuffer)
        .resize(reducedWidth, reducedHeight)
      [imageFileExtension]({ quality: 80 }) // If .jpeg, use jpeg() with { quality: 80 }
        .toBuffer();
    } else {
      // Generate a PNG from the modified SVG
      const { width, height } = await sharp(modifiedBuffer).metadata();
      const reducedWidth = Math.floor(width * 0.9);
      const reducedHeight = Math.floor(height * 0.9);

      resizedImageBuffer = await sharp(modifiedBuffer)
        .resize(reducedWidth, reducedHeight)
        .png({ compressionLevel: 9, quality: 80 })
        .toBuffer();
    }

    // Upload the resized PNG/JPEG buffer to GCS
    const fileInBucketPNG = bucket.file(imageFileName);
    await fileInBucketPNG.save(resizedImageBuffer, {
      resumable: false,
      metadata: {
        // If imageFile was a JPEG, then contentType should be 'image/jpeg', otherwise 'image/png'
        contentType: imageFileExtension === 'jpeg' ? 'image/jpeg' : 'image/png',
      },
    });

    // Generate a public URL for the PNG
    const publicUrlPNG = `https://storage.googleapis.com/${bucketName}/${imageFileName}`;

    // ---------------------
    //   Save to MongoDB
    // ---------------------
    const result = await svgDataCollection.insertOne({
      svgData: publicUrlSVG,     // store the SVG public URL
      pngData: publicUrlPNG,     // store the PNG public URL
      colors,
      categories: selectedCategories,
      hasSimplifiedSvg,          // <<--- Store the boolean value
      date: new Date().toISOString(),
    });

    return NextResponse.json(
      { message: 'Data inserted successfully', result },
      { headers }
    );
  } finally {
    await client.close();
    // Clean up the locally-saved file
    await fs.unlink(filePath);
  }
}

export async function GET(req) {
  const headers = setCORSHeaders();

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
        pngData: 1,
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
      svgData: rawSvgData,
      pngData: data.pngData,
    };

    return NextResponse.json(responseData, { headers });
  } finally {
    await client.close();
  }
}
