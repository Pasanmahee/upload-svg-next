# Process Image Private Preview Fix

## Problem

The Process Image page exposed `https://storage.googleapis.com/.../preview-*.webp` as the preview link. In deployments where the bucket is private, clicking the preview opened a Google Cloud `AccessDenied` page because anonymous callers do not have `storage.objects.get`.

## Fix

- Draft processing now returns inline `previewDataUrl` and `svgDataUrl` values for the admin preview/download flow.
- Private GCS URLs are preserved only as `gcsUrlSvg` / `gcsUrlPng` metadata.
- The Process Image admin page displays the inline preview image and download buttons.
- The UI no longer encourages opening private `storage.googleapis.com` preview URLs.

## Result

Admin can preview processed images immediately even when the GCS bucket is private.
