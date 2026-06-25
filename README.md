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
## Admin login for Manage Uploaded Images

`/manage-images` no longer uses the old shared `x-admin-key` flow.

For now, you can log in by typing an email address on the Manage Uploaded Images page. The backend accepts that temporary login only when the email exactly matches `ADMIN_EMAILS` in `.env.local`.

```env
ADMIN_EMAILS="your-admin@gmail.com,another-admin@gmail.com"
```

Google/Firebase login is still kept in the code for later. When Firebase env values are not configured, the Google button stays disabled and the email login can still be used.

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

- Public library can be viewed without login.
- `My works` requires a valid Firebase login and shows only that user's records.
- `All / admin view`, editing public records, and deleting public records require either:
  - an email login matching `ADMIN_EMAILS`, or
  - a signed-in Google/Firebase account whose email is listed in `ADMIN_EMAILS`.
- Admin emails can manage both public and private image records.
