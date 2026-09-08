# Private GCS asset access fix

- Keeps the Google Cloud Storage bucket private.
- Uses normal V4 signed URLs when available.
- If V4 signing fails, returns a short-lived same-origin HMAC-protected `/api/gcs-file` URL instead of leaking an unusable raw `storage.googleapis.com` URL.
- The proxy validates expiry/signature and only reads configured/allowed buckets.
- Existing raw GCS references can remain in MongoDB; API responses are converted to readable temporary URLs.
- Optional env: `GCS_PROXY_SECRET` (recommended). If absent, `GCP_SA_KEY_B64` is used as the HMAC secret.
