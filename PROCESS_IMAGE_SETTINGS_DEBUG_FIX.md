# Process Image settings and debug response fix

## Fixed

- Root `/` image processing page now shows visible processing settings.
- Added advanced settings for color clustering, facet reduction, resize, speckle cleanup, border smoothing, label halo, and stroke style.
- Form now sends all visible settings to `/api/process-image/[userId]`.
- Added debug checkbox to request detailed API errors during testing.
- `/api/process-image/[userId]` now returns the processing stage and detailed error message when debug mode is enabled or server is not production.
- API response now includes selected processing options after successful processing.

## Useful testing flow

1. Open backend admin root page `/`.
2. Upload a smaller image first.
3. Start with K = 8 to 16 and Max facets = 100 to 300.
4. Keep debug enabled while testing.
5. If processing fails, check `stage` and `details` in the API response.

## Notes

The page uses the admin session cookie when logged in. The mobile app should still call the same route with Firebase Bearer token.
