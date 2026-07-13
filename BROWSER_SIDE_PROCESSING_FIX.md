# Browser-side image processing fix

## Problem

The Process Image page uploaded the original image to `POST /api/process-image/[userId]`. The Vercel function then ran Sharp, k-means clustering, facet creation, facet reduction, border tracing, label placement, SVG creation, preview raster creation, cloud upload, and MongoDB storage. Detailed images could exceed the function's 60-second execution limit and return `FUNCTION_INVOCATION_TIMEOUT` / HTTP 504.

## Updated flow

```text
Selected image
    ↓
Browser Canvas decoding and resizing
    ↓
Browser paint-by-number processing
    ↓
Generated SVG + WebP/PNG preview + palette
    ↓
POST /api/process-image/[userId]/save
    ↓
MongoDB/GCS draft storage only
```

## Main updated files

- `app/page.tsx`
  - Calls `processImageInBrowser()` instead of the heavy server route.
  - Shows browser progress and processing time.
  - Keeps local generated preview/download links even when draft storage fails.
- `lib/browserImageProcessor.ts`
  - Browser Canvas image decoding/resizing.
  - Runs the existing paint-by-number TypeScript modules in the browser.
  - Generates SVG and an optimized WebP/PNG preview locally.
- `app/api/process-image/[userId]/save/route.ts`
  - Lightweight authenticated draft-storage endpoint.
  - Does not import or execute Sharp, k-means, facet generation, or SVG rendering.
- `app/layout.js`
  - Removed because it duplicated `app/layout.tsx`, loaded Google Fonts during build, and prevented the intended authenticated layout from being selected.

## Compatibility

- The original `POST /api/process-image/[userId]` route is retained for older clients.
- The browser processor currently supports **Facets (paint-by-number)** geometry, matching the previously supported server route.
- The generated item is still a draft and does not enter My Works until it is intentionally uploaded from the Upload SVG page.

## Validation

- `npx tsc --noEmit` passed.
- `npm run build` passed with Next.js 16.1.6.
