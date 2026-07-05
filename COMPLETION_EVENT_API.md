# Completion Event API

Adds the first backend building block for the completion screen, achievements, leaderboards, weekly progress, rating-prompt timing, and analytics.

## POST `/api/completions`

Authentication: `Authorization: Bearer <Firebase ID token>`

Request body:

```json
{
  "imageId": "65f...",
  "levelId": "beginner",
  "mode": "relax",
  "timeSeconds": 462,
  "accuracy": 98.5,
  "mistakes": 2,
  "usedHints": 1,
  "completedAt": "2026-07-04T10:30:00.000Z",
  "isDailyChallenge": true,
  "challengeDate": "2026-07-04",
  "clientCompletionId": "optional-client-idempotency-key"
}
```

Stored fields:

- `userId`
- `userEmail`
- `imageId`
- `imageObjectId` when `imageId` is a MongoDB ObjectId
- `levelId`
- `mode`: `relax` or `challenge`
- `timeSeconds`
- `accuracy`
- `mistakes`
- `usedHints`
- `completedAt`
- `isDailyChallenge`
- `challengeDate`
- `clientCompletionId`
- `createdAt`
- `updatedAt`

The route also updates the user's `levelProgress` so the frontend can unlock the next level from this single completion event.

Response includes:

- saved completion event
- updated level progress
- newly unlocked level, if any
- total completions
- weekly completions for the last 7 days
- daily challenge completion count
- unique completed image count
- `ratingPromptCandidate`, true when the user reaches 3 unique completed images
- best score for that image

## GET `/api/completions?limit=20`

Authentication: `Authorization: Bearer <Firebase ID token>`

Returns the authenticated user's completion stats, current level progress, and recent completion history.
