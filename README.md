# upload-svg-next

Next.js (App Router) backend + simple UI for **image → SVG (paint-by-number facets)** and **SVG → PNG** generation.

## What was added

- `POST /api/process-image/:userId` — accepts an uploaded raster image and returns:
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
  - `GOOGLE_APPLICATION_CREDENTIALS` (path to service-account JSON)
  - `GCP_SA_KEY_B64` (base64-encoded service-account JSON)
- `DISABLE_GCS=1` to return inline `data:` URLs instead of uploading files

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
