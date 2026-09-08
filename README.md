# upload-svg-next

## Browser-side Process Image fix

The **Process Image** page now performs the expensive paint-by-number work in the user's web browser instead of inside the Vercel function:

1. The browser decodes and resizes the selected image with Canvas.
2. K-means colour reduction, facet creation/reduction, border tracing, segmentation, label placement, SVG generation, and preview rendering run locally.
3. Only the finished SVG, preview image, palette, and settings are posted to `POST /api/process-image/:userId/save`.
4. The lightweight API route stores the generated draft in MongoDB/GCS and returns the **Load into Upload SVG** link.

The old `POST /api/process-image/:userId` server processor remains for backward compatibility, but the admin web page no longer uses it. Therefore, the page is no longer limited by Vercel's 60-second function timeout during image processing.

Production validation completed with:

```bash
npm ci
npm run build
```


Next.js (App Router) backend + simple UI for **image → SVG (paint-by-number facets)** and **SVG → PNG** generation.

Image processing uses deterministic random seed `42` in both browser and legacy
server paths, so identical inputs and settings generate consistent clustering.
K-means writes opaque RGBA output, facet merging uses perceptual CIEDE2000
distance, and generated SVGs separate interactive fills, unique shared borders,
and labels into explicit `fills`, `borders`, and `labels` groups.

## What was added

- `POST /api/process-image/:userId/save` — saves browser-generated SVG/preview drafts without repeating image processing on Vercel.
- `POST /api/process-image/:userId` — legacy server-side raster processor retained for older clients; it returns:
  - SVG URL (GCS) or inline `data:` URL fallback
  - PNG URL (GCS) or inline `data:` URL fallback
  - extracted colour palette
  - (optional) a MongoDB record in collection `svgdata`
- `DELETE /api/delete-image/:userId/:recordId` — deletes the MongoDB record and best-effort deletes the corresponding SVG/PNG files in the configured GCS bucket
- A protected login-first UI at `/`, `/upload-svg`, and `/manage-images`

## Environment variables

Copy `.env.example` to `.env.local` and fill:

- `MONGODB_URI` (required if you want persistence)
- `DB_NAME` (optional)
- `GCS_BUCKET_NAME` (recommended; back-compat: `GCS_BUCKET`)
- Credentials (choose ONE):
  - `GCP_SA_KEY_B64` (**recommended for Vercel/Docker**; base64-encoded service-account JSON)
  - `GCP_SA_KEY_JSON` (complete service-account JSON in one env value)
  - `GOOGLE_APPLICATION_CREDENTIALS` (only when that JSON file really exists inside the running host/container)
  - Existing `FIREBASE_SERVICE_ACCOUNT_B64` / `FIREBASE_SERVICE_ACCOUNT_JSON` can also be reused if that service account has access to the GCS bucket.
- `DISABLE_GCS=1` to return inline `data:` URLs instead of uploading files

### Important: `/app/keys/service-account.json` ENOENT

If a deployment logs `The file at /app/keys/service-account.json does not exist`, the runtime has a stale `GOOGLE_APPLICATION_CREDENTIALS` value but no mounted file at that path. The app now ignores a missing credential-file path instead of repeatedly throwing `ENOENT`, and it will use `GCP_SA_KEY_B64`, `GCP_SA_KEY_JSON`, Firebase Admin service-account env vars, or ADC instead.

For Vercel, remove the stale `GOOGLE_APPLICATION_CREDENTIALS=/app/keys/service-account.json` variable and add `GCP_SA_KEY_B64`. Redeploy after changing environment variables.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. You will be redirected to `/login` until you log in with an email listed in `ADMIN_EMAILS`.

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
## Login-first admin access

The app now shows `/login` before loading any page. `/`, `/upload-svg`, `/manage-images`, and the non-auth API routes are protected by a signed login cookie.

For now, log in with an email address that exactly matches `ADMIN_EMAILS` in `.env.local`:

```env
ADMIN_EMAILS="your-admin@gmail.com,another-admin@gmail.com"
ADMIN_SESSION_SECRET="use-a-long-random-secret-here"
```

The old shared `x-admin-key` flow is not used. Google/Firebase login code is still kept for later, but the simple email login is the active path for now.

### Optional Firebase Google setup for later

1. In Firebase Console, open **Authentication → Sign-in method**.
2. Enable **Google** as a sign-in provider.
3. In **Project settings → General → Your apps**, create/select a Web app and copy the Firebase config values into `.env.local`:
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
   - optional storage/sender fields
4. Add Firebase Admin SDK service-account credentials for server-side ID-token verification:
   - `FIREBASE_SERVICE_ACCOUNT_B64`, or
   - `FIREBASE_SERVICE_ACCOUNT_JSON`, or
   - `GOOGLE_APPLICATION_CREDENTIALS`

Restart the app after editing env values:

```bash
rm -rf .next
npm install
npm run dev
```

### Access rules

- No app page loads until login succeeds.
- Non-auth API routes return `401 Login required` without the signed login cookie.
- Admin emails listed in `ADMIN_EMAILS` can use the upload page, image management page, `All / admin view`, edit, replace, and delete actions.
- `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me` remain open so login/logout can work.
