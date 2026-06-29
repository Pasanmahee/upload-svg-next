# Process Image JSON Response Fix

## Problem

The UI showed:

```json
{
  "error": "Unexpected token 'A', \"An error o\"... is not valid JSON"
}
```

This happens when the browser calls `response.json()` but the server/platform returns plain text such as `An error occurred...` instead of JSON. It can happen when Vercel times out/crashes a long image-processing request before the Next.js route returns its normal JSON error.

## Fixes

- `app/page.tsx` now reads the response as text first and safely parses JSON. If the server returns text/HTML, the real status/body is displayed instead of a JSON parse error.
- `app/api/process-image/[userId]/route.ts` now declares `maxDuration = 60` to reduce Vercel timeout/plain-text failures for longer processing jobs.
- `proxy.ts` now lets `POST /api/process-image/*` reach the route handler so Firebase/admin auth is checked inside the route, not blocked by the backend admin proxy.
- Invalid optional JSON form data now returns a clean JSON 400 response.

## Note

If Vercel still returns a plain platform error, reduce `maximumNumberOfFacets`, upload a smaller image, or use a Vercel plan/server environment with enough function duration for image vectorization.
