# Daily Images Level Lock Fix

Fixes `/daily-images` showing locked-level images.

## What changed

- `GET /api/dailyimagedata` now supports:

```text
unlockedLevelIds=beginner,easy-animals
```

- The route uses the same level assignment logic as `/api/levels/images`.
- Manual image assignments from `/game-settings` are respected.
- Filtering happens before pagination, so locked-level images do not fill early pages and create wrong results.
- Response items now include `levelId`, `categories`, `title`, and dates for safer frontend filtering/cache.

## File changed

- `app/api/dailyimagedata/route.ts`
