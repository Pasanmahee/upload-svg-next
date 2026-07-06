# Real Pack System

Implemented backend support for real image packs.

## User APIs

- `GET /api/packs` lists active packs with ownership/download state.
- `GET /api/packs/:packId` returns one pack.
- `GET /api/packs/:packId/manifest` returns a downloadable manifest for owned/free packs.
- `POST /api/packs/:packId/unlock` unlocks a pack using its rule: free, coins/premium, rewarded, streak, achievement.
- `POST /api/packs/:packId/download-started` records that a user downloaded a pack.
- `POST /api/packs/:packId/deleted` records that a user deleted downloaded local pack files.

## Admin APIs

- `GET /api/admin/packs`
- `POST /api/admin/packs`
- `GET /api/admin/packs/:packId`
- `PATCH /api/admin/packs/:packId`
- `DELETE /api/admin/packs/:packId` soft-disables a pack.
- `POST /api/admin/packs/:packId/images` replaces image IDs and bumps manifest version.

## Collections

- `packs`
- `packOwnership`
- `packDownloads`

Default seed packs are created automatically: free starter pack, 7-day streak pack, flower achievement pack, premium/coins mandala pack, and rewarded animal pack.

## Build check

`npm run build` was verified after adding pack routes.
