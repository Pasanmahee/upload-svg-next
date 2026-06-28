# Public API Auth Fix

This update fixes 401 errors from the public/mobile app when calling backend read APIs.

## Problem

`proxy.ts` protected almost every `/api/*` route behind the backend admin session cookie. That is correct for admin routes, but wrong for public app read routes such as:

- `GET /api/daily-challenge`
- `GET /api/levels`
- `GET /api/levels/images`
- `GET /api/images`
- `GET /api/categories`
- `GET /api/game-assets/:id`

Because the Android/frontend app does not have the backend admin cookie, Vercel returned `401 Unauthorized` before the real route handler could run.

## Fix

Added `isPublicApiRequest()` in `proxy.ts` and whitelisted the public read APIs.

The POST APIs below are also allowed through the proxy, but they are still protected inside their route handlers by Firebase auth:

- `POST /api/daily-challenge`
- `POST /api/levels/progress`

Admin APIs and admin UI routes remain protected by the admin session.

## Deploy

Deploy this backend, then redeploy/clear Vercel cache if needed.
