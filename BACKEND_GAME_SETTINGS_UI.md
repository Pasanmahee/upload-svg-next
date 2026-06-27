# Backend Game Settings UI

This update adds a new backend/admin page:

```text
/game-settings
```

## 1. Daily Puzzle / Daily Reward

The admin UI can now edit:

- Daily reward coins
- Streak reward day count
- Special pack ID
- Special pack name
- Today’s fixed puzzle image

If no fixed image is selected, the backend keeps using automatic date-based puzzle selection.

The public app still calls:

```text
GET  /api/daily-challenge
POST /api/daily-challenge
```

Those APIs now read the saved backend settings from MongoDB.

## 2. Level System

The admin UI can now edit:

- Level names
- Short names
- Emojis
- Descriptions
- Unlock requirement counts
- Auto-group keywords

It can also assign uploaded public images to a specific level. Manual image assignment is saved as `levelId` on the `svgdata` document and overrides keyword/category auto grouping.

The public app still calls:

```text
GET  /api/levels
GET  /api/levels/images?levelId=beginner&page=1&limit=12
POST /api/levels/progress
```

Those APIs now read the saved level settings from MongoDB.

## New backend API

```text
GET   /api/admin/game-config
PATCH /api/admin/game-config
```

These are protected by the same admin login/session logic as the existing backend UI.

## MongoDB storage

Settings are stored in:

```text
Collection: appSettings
Document:   _id = "game-features"
```

No manual migration is required. The document is created automatically the first time settings are saved.
