# GCS credential-path ENOENT fix

## Problem

The deployment had `GOOGLE_APPLICATION_CREDENTIALS=/app/keys/service-account.json`, but that file was not present inside the runtime container. `@google-cloud/storage` resolves this variable lazily, so every signed URL attempt failed with `ENOENT: lstat '/app'`, which made `/api/images` return 500.

## Fix

- `lib/gcs.ts` now validates file-based credentials before Google Auth can use them.
- A missing `GOOGLE_APPLICATION_CREDENTIALS` path is ignored instead of causing repeated ENOENT failures.
- Added explicit credential support for:
  - `GCP_SA_KEY_B64`
  - `GCP_SA_KEY_JSON`
  - `GCP_PROJECT_ID` + `GCP_CLIENT_EMAIL` + `GCP_PRIVATE_KEY`
  - `FIREBASE_SERVICE_ACCOUNT_B64` / `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `FIREBASE_ADMIN_SA_B64` / `FIREBASE_ADMIN_SA_JSON`
- Proxy URL signing can reuse `ADMIN_SESSION_SECRET` when `GCS_PROXY_SECRET` is not set.
- Docker Compose now passes the supported env-based credential variables.
- Added `.env.example` with the recommended deployment setup.

## Vercel setup

Recommended:

```env
GCS_BUCKET_NAME=ragappstoragebucket
GCP_SA_KEY_B64=<base64 service-account JSON>
GCS_PROXY_SECRET=<long random secret>
```

Remove this stale value unless a real file is mounted there:

```env
GOOGLE_APPLICATION_CREDENTIALS=/app/keys/service-account.json
```

Redeploy after changing environment variables.
