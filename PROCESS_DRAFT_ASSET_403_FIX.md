# Process Draft Asset 403 Fix

Fixed the Process Image → Upload SVG draft flow.

## Problem

Upload SVG could show:

```text
Error loading generated SVG: Failed to fetch draft asset: 403 Forbidden
```

This happened when a processed draft stored a GCS URL that existed but was not publicly readable. Loading the draft tried to fetch the private URL and failed.

## Fix

- Process Image now stores inline SVG and preview data in `processDrafts` as `svgInlineData` and `pngInlineData`.
- `/api/process-drafts/:draftId` prefers inline draft data, so Upload SVG does not depend on public GCS access.
- Admin users can load drafts even when the draft `userId` is `anonymous` or another process user ID.
- Draft deletion also allows admin users.

Reprocess the image once after deploying this fix so the new draft includes inline assets.
