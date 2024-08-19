import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import { join } from 'path';

const uri = "mongodb+srv://pasanmahee:fVgPys0uknMCuT8S@cluster0.zwasfmo.mongodb.net/svgfacetpaintbynumber?retryWrites=true&w=majority";
const client = new MongoClient(uri);

export async function POST(req) {
  const formData = await req.formData();
  const file = formData.get('file');
  const colors = JSON.parse(formData.get('colors'));

  if (!file || !colors) {
    return NextResponse.json({ message: 'File or colors missing' }, { status: 400 });
  }

  const filePath = join(process.cwd(), 'uploads', file.name);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Ensure the uploads directory exists
  await fs.mkdir(join(process.cwd(), 'uploads'), { recursive: true });

  // Save the uploaded SVG file to the server
  await fs.writeFile(filePath, buffer);

  const svgData = buffer.toString('utf8'); // Convert the buffer to a string

  try {
    await client.connect();
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    const result = await collection.insertOne({ svgData, colors });
    return NextResponse.json({ message: 'Data inserted successfully', result });
  } finally {
    await client.close();

    // Optionally delete the uploaded file after processing
    await fs.unlink(filePath);
  }
}

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
  
    if (!id) {
      return NextResponse.json({ message: 'ID is required' }, { status: 400 });
    }
  
    try {
      await client.connect();
      const database = client.db('svgfacetpaintbynumber');
      const collection = database.collection('svgdata');
  
      const data = await collection.findOne({ _id: new ObjectId(id) });
  
      if (!data) {
        return NextResponse.json({ message: 'Document not found' }, { status: 404 });
      }
  
      return NextResponse.json(data);
    } finally {
      await client.close();
    }
  }