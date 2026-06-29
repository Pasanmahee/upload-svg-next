# Process Image Forbidden Fix

`/api/process-image/[userId]` no longer trusts the URL userId as the owner. It verifies the Firebase/admin token, then stores the processed image under `auth.uid`.

This fixes valid requests returning `{ "error": "Forbidden" }` when the app had silently created an anonymous Firebase user but passed an older local/device userId in the route URL.
