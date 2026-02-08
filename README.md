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
- `GCS_BUCKET_NAME` (recommended; back-compat: `GCS_BUCKET`)
- Credentials (choose ONE):
  - `GOOGLE_APPLICATION_CREDENTIALS` (path to service-account JSON)
  - `GCP_SA_KEY_B64` (base64-encoded service-account JSON)
- `DISABLE_GCS=1` to return inline `data:` URLs instead of uploading files

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Notes

- On Next.js 15+ / 16, dynamic route `params` are Promises; route handlers unwrap them with `await`.
- If you see "Duplicate page/route detected", delete the extra `page.*` or `route.*` file so only one exists per route.

## Docker

```bash
cp .env.example .env
# edit .env

docker compose up --build
```

The container listens on `http://localhost:8080`.


git config user.name  "wppmhroo-star"
git config user.email "wppmh.roo@gmail.com"
git config credential.username "wppmhroo-star"
git push -u wppmh main

git config user.name  "wppmhroo-star"
git config user.email "wppmh.roo@gmail.com"
git config credential.username "wppmhroo-star"
git push -u wppmh develop

git config user.name  "pasanmahee"
git config user.email "pasanmahee.roo@gmail.com"
git config credential.username "pasanmahee"
git push -u origin main

git config user.name  "pasanmahee"
git config user.email "pasanmahee.roo@gmail.com"
git config credential.username "pasanmahee"
git push -u origin develop