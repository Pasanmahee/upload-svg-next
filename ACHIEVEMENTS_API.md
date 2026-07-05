# Achievements API

Adds backend achievement progress for the Number Paint game.

## Routes

### GET /api/achievements

Returns the current Firebase user's achievement progress.

Requires:

```http
Authorization: Bearer <firebase-id-token>
```

Response shape:

```json
{
  "success": true,
  "achievements": [
    {
      "id": "first-picture-completed",
      "name": "First Picture Completed",
      "description": "Complete your first coloring picture.",
      "icon": "🎉",
      "progress": 1,
      "target": 1,
      "percentage": 100,
      "unlocked": true,
      "unlockedAt": "2026-07-05T00:00:00.000Z"
    }
  ],
  "newlyUnlocked": [],
  "stats": {
    "totalAchievements": 5,
    "unlockedAchievements": 1
  }
}
```

### POST /api/achievements/progress

Recalculates and stores the current Firebase user's achievement progress from trusted backend data.

The request body is optional. The server does not trust client-sent progress values; it recalculates from `completions`, `completionStats`, and `levelProgress`.

```json
{
  "source": "completion"
}
```

## Current achievements

| ID | Name | Rule |
|---|---|---|
| `first-picture-completed` | First Picture Completed | Total completions >= 1 |
| `ten-pictures-completed` | 10 Pictures Completed | Total completions >= 10 |
| `no-mistake-master` | No Mistake Master | At least one completion with 0 mistakes |
| `fast-painter` | Fast Painter | At least one completion within 5 minutes and at least 90% accuracy |
| `flower-collection-completed` | Flower Collection Completed | Complete the configured Flower level unlock requirement, normally 3 flower pictures |

## Completion API integration

`POST /api/completions` now also returns:

```json
{
  "achievements": {
    "achievements": [],
    "newlyUnlocked": [],
    "stats": {}
  }
}
```

This lets the frontend show achievement unlock messages immediately after a puzzle is completed.
