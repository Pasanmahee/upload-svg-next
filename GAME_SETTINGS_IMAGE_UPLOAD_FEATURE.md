# Game Settings Image Upload Feature

This update improves `/game-settings` so game feature icons are no longer limited to emoji.

## What changed

### 1. Daily Puzzle / Daily Reward
The admin can now upload:
- Daily Challenge image/icon
- 7-day Special Pack reward image/icon

The selected image is saved into the game config and returned by the public Daily Challenge API.

### 2. Level System
Each level can now use an uploaded image instead of an emoji:
- Beginner
- Easy Animals
- Flowers
- Cartoons
- Hard Mandala
- Expert

Emoji remains as a fallback only when no image has been uploaded.

### 3. Reusable future image upload route
A reusable backend endpoint was added:

```text
POST /api/admin/game-assets
```

Use multipart form data:

```text
image   = uploaded image file
purpose = daily-challenge-icon | daily-streak-pack-icon | level-beginner | future-feature-name
```

The response returns a stable URL:

```text
/api/game-assets/<asset-id>
```

This same endpoint can be reused for future game settings images.

### 4. Public asset route
Uploaded setting images are served from:

```text
GET /api/game-assets/<asset-id>
```

They are cached long-term because the generated UUID URL changes for each upload.

## Compression / optimisation

Every uploaded image is processed by Sharp:
- converted to WebP
- resized to fit inside the configured maximum dimension
- compressed with multiple quality and dimension attempts
- transparency is preserved
- saved as a small WebP file in MongoDB `gameAssets`

Default environment controls:

```bash
GAME_ASSET_TARGET_KB=28
GAME_ASSET_MAX_DIM=512
GAME_ASSET_MIN_DIM=96
GAME_ASSET_MAX_UPLOAD_MB=8
```

The optimiser tries to reach the target size, but if the image is complex it keeps the smallest acceptable WebP it can produce.

## APIs updated

```text
GET   /api/admin/game-config
PATCH /api/admin/game-config
POST  /api/admin/game-assets
GET   /api/game-assets/<asset-id>
GET   /api/daily-challenge
GET   /api/levels
GET   /api/levels/images
```

Public APIs return absolute asset URLs for mobile apps, while the admin UI can use local relative URLs.
