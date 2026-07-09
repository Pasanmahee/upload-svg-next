# Process Image → Upload SVG Draft Flow

This update prevents backend/admin generated Process Image outputs from being saved directly into the mobile app's **My Works** list.

## What changed

- The Process Image admin page now sends `draftOnly=true` to `/api/process-image/[userId]`.
- When `draftOnly=true`, the generated SVG/preview is saved to a separate `processDrafts` collection instead of `svgdata`.
- `processDrafts` records are temporary upload drafts and are not returned by My Works/image listing APIs.
- The Process Image result shows a **Load into Upload SVG** button.
- `/upload-svg?draftId=<id>` loads the generated SVG file, preview image, and palette automatically into the Upload SVG form.
- The admin can then select level/categories and click **Upload**. Only that final upload creates the real app/library record.

## New API

```text
GET /api/process-drafts/:draftId
```

Returns generated SVG/preview as same-origin data URLs so the Upload SVG page can create real `File` objects without CORS issues.

## Why

This keeps test/process generations out of users' app content until the SVG has been reviewed and intentionally uploaded.
