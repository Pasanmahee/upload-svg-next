# Vercel Process Image Timeout Fix

## Problem

`POST /api/process-image/[userId]` could exceed Vercel's 60-second Hobby-plan function limit and return:

```text
504 FUNCTION_INVOCATION_TIMEOUT
```

Highly detailed, noisy, or compressed images can create thousands of tiny facets. Facet reduction then consumes most of the function execution time, and Vercel terminates the function before the route can return JSON.

## Fix applied

The Process Image page now enables **Vercel-safe processing** by default. The backend also enables it automatically when `VERCEL=1` and the client does not send an explicit value.

The safe profile:

- caps the working image at 384 px;
- applies light blur and median smoothing before clustering;
- uses one narrow-strip cleanup pass;
- uses the faster facet-reduction direction;
- raises the minimum facet size to 25 pixels;
- limits output to 160 facets;
- limits preview generation to 384 px.

The API response records the actual changes in:

```json
{
  "processOptions": {
    "serverlessSafeMode": true,
    "performanceAdjustments": []
  }
}
```

## Optional environment setting

The safe working dimension can be changed without editing code:

```env
PROCESS_IMAGE_SAFE_MAX_DIM=384
```

Accepted values are bounded to 256-512 px. Keep 384 for Vercel Hobby. Higher values may time out on complex images.

## Full-quality processing

Turn off **Vercel-safe processing** only when running locally, using a background worker, or using infrastructure with a longer execution limit. The route still keeps `maxDuration = 60` so it remains deployable on Vercel Hobby.
