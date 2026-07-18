/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoClient, getDbName } from "@/lib/mongo";
import { getBucketName, getStorage } from "@/lib/gcs";
import { type AuthResult, isAdminEmail, verifyFirebaseAuth } from "@/lib/auth";

export const runtime = "nodejs";

type GcsRef = { bucket: string; objectPath: string };
type DownloadKind = "svg" | "palette" | "webp";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Email",
  "Cache-Control": "private, no-store",
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function parseKind(value: string | null): DownloadKind | null {
  const kind = String(value || "").toLowerCase();
  if (kind === "svg" || kind === "palette" || kind === "webp") return kind;
  return null;
}

function parseDataUrl(
  value: string,
): { buffer: Buffer; contentType: string } | null {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;

  const contentType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  try {
    return {
      buffer: isBase64
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf8"),
      contentType,
    };
  } catch {
    return null;
  }
}

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>[?query]
 *  - gs://<bucket>/<object>
 *  - <objectPath> (assumes default bucket)
 */
function parseGcsObjectRef(value: unknown): GcsRef | null {
  if (typeof value !== "string" || !value) return null;
  if (
    value.startsWith("data:") ||
    value.startsWith("http://") ||
    (value.startsWith("https://") &&
      !value.startsWith("https://storage.googleapis.com/"))
  )
    return null;

  const noQuery = value.split("?")[0];

  if (noQuery.startsWith("gs://")) {
    const rest = noQuery.slice("gs://".length);
    const firstSlash = rest.indexOf("/");
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const httpsPrefix = "https://storage.googleapis.com/";
  if (noQuery.startsWith(httpsPrefix)) {
    const rest = noQuery.slice(httpsPrefix.length);
    const firstSlash = rest.indexOf("/");
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const objectPath = noQuery.replace(/^\/+/, "");
  if (!objectPath) return null;
  return { bucket: getBucketName(), objectPath };
}

function inferContentType(
  kind: DownloadKind,
  storedValue: unknown,
  fallback?: string,
): string {
  if (typeof storedValue === "string" && storedValue.startsWith("data:")) {
    const parsed = parseDataUrl(storedValue);
    if (parsed?.contentType) return parsed.contentType;
  }
  if (fallback) return fallback;
  if (kind === "svg") return "image/svg+xml; charset=utf-8";
  if (kind === "palette") return "application/json; charset=utf-8";
  return "image/webp";
}

async function readStoredFile(
  storedValue: unknown,
  kind: DownloadKind,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (typeof storedValue !== "string" || !storedValue.trim()) {
    throw new Error("File is missing on this record");
  }

  const trimmed = storedValue.trim();

  const dataUrl = parseDataUrl(trimmed);
  if (dataUrl) return dataUrl;

  if (kind === "svg" && /<svg[\s>]/i.test(trimmed)) {
    return {
      buffer: Buffer.from(trimmed, "utf8"),
      contentType: "image/svg+xml; charset=utf-8",
    };
  }

  const ref = parseGcsObjectRef(trimmed);
  if (ref) {
    const storage = getStorage();
    const file = storage.bucket(ref.bucket).file(ref.objectPath);
    const [[buffer], [metadata]] = await Promise.all([
      file.download(),
      file.getMetadata().catch(() => [{ contentType: undefined }] as any),
    ]);
    return {
      buffer,
      contentType: inferContentType(kind, trimmed, metadata?.contentType),
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetch(trimmed);
    if (!res.ok) throw new Error(`Could not fetch stored file (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: inferContentType(
        kind,
        trimmed,
        res.headers.get("content-type") || undefined,
      ),
    };
  }

  throw new Error("Unsupported stored file reference");
}

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  try {
    if (typeof v?.toISOString === "function") return v.toISOString();
  } catch {
    // ignore
  }
  return String(v);
}

function normalizeHexColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((c) => String(c).trim())
        .filter((c) => /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(c))
        .map((c) => c.toUpperCase()),
    ),
  );
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "download";
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function fileHeaders(
  filename: string,
  contentType: string,
  disposition: "attachment" | "inline" = "attachment",
): HeadersInit {
  const safe = safeFilename(filename);
  return {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  };
}

function assertAdminOrOwner(
  doc: any,
  auth: AuthResult,
): { ok: true } | { ok: false; status: number; error: string } {
  const authUid = auth.ok ? auth.uid : null;
  const isAdmin = auth.ok && isAdminEmail(auth.email);

  if (isAdmin) return { ok: true };

  if (doc?.userId && typeof doc.userId === "string") {
    if (!authUid) return { ok: false, status: 401, error: "Unauthorized" };
    if (authUid !== doc.userId)
      return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true };
  }

  // Public records are downloadable after the main app login has passed.
  return { ok: true };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json(
      { error: "Invalid id" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { searchParams } = new URL(request.url);
  const kind = parseKind(searchParams.get("kind"));
  const inline = searchParams.get("inline") === "1";
  if (!kind) {
    return NextResponse.json(
      { error: "Invalid download kind" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const auth = await verifyFirebaseAuth(request);
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection("svgdata");

    const doc = await collection.findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          _id: 1,
          userId: 1,
          svgData: 1,
          pngData: 1,
          colors: 1,
          categories: 1,
          hasSimplifiedSvg: 1,
          createdAt: 1,
          updatedAt: 1,
          date: 1,
        },
      },
    );

    if (!doc) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const access = assertAdminOrOwner(doc, auth);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status, headers: CORS_HEADERS },
      );
    }

    const shortId = id.slice(-8);

    if (kind === "palette") {
      const payload = {
        id,
        colors: normalizeHexColors((doc as any).colors),
        categories: Array.isArray((doc as any).categories)
          ? (doc as any).categories
          : [],
        hasSimplifiedSvg: Boolean((doc as any).hasSimplifiedSvg),
        createdAt: toIso((doc as any).createdAt || (doc as any).date),
        updatedAt: toIso((doc as any).updatedAt),
      };
      const buffer = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
      return new NextResponse(bufferToArrayBuffer(buffer), {
        headers: fileHeaders(
          `palette-${shortId}.json`,
          "application/json; charset=utf-8",
        ),
      });
    }

    if (kind === "svg") {
      const file = await readStoredFile((doc as any).svgData, "svg");
      return new NextResponse(bufferToArrayBuffer(file.buffer), {
        headers: fileHeaders(`image-${shortId}.svg`, file.contentType),
      });
    }

    const file = await readStoredFile((doc as any).pngData, "webp");
    return new NextResponse(bufferToArrayBuffer(file.buffer), {
      headers: fileHeaders(
        `original-${shortId}.webp`,
        file.contentType,
        inline ? "inline" : "attachment",
      ),
    });
  } catch (err: unknown) {
    console.error("images/[id]/download GET error:", err);
    return NextResponse.json(
      { error: "Failed to download file", details: getErrorMessage(err) },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
