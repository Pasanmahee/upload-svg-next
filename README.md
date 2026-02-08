# upload-svg-next

Next.js (App Router) backend + simple UI for **image → SVG (paint-by-number facets)** and **SVG → PNG** generation.

## What was added

- `POST /api/process-image/:userId` — accepts an uploaded raster image and returns:
  - SVG URL (GCS) or inline `data:` URL fallback
  - PNG URL (GCS) or inline `data:` URL fallback
  - extracted colour palette
  - (optional) a MongoDB record in collection `svgdata`
- `DELETE /api/delete-image/:userId/:recordId` — deletes the MongoDB record and best-effort deletes the corresponding SVG/PNG files in the configured GCS bucket
- A basic test UI at `/` (no auth)

## Environment variables

Copy `.env.example` to `.env.local` and fill:

- `MONGODB_URI` (required if you want persistence)
- `DB_NAME` (optional)
- `GCS_BUCKET_NAME` (recommended)
- `GOOGLE_APPLICATION_CREDENTIALS` (recommended; path to service-account JSON)
- `DISABLE_GCS=1` to return inline `data:` URLs instead of uploading files

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker

```bash
cp .env.example .env
# edit .env

docker compose up --build
```

The container listens on `http://localhost:8080`.
