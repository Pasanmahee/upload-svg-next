# Level System Feature

Added a progression layer to the Library screen.

## Levels

1. Beginner
2. Easy Animals
3. Flowers
4. Cartoons
5. Hard Mandala
6. Expert

The first level is unlocked by default. Later levels unlock when the previous level has enough completed pictures.

## Frontend behaviour

- Landing page shows a horizontal Levels card.
- Locked levels appear dimmed and cannot be opened.
- Opening an image passes `levelId` to `/app/home`.
- When the puzzle is fully painted, `/app/home` saves level progress locally.
- If the user is signed in and online, progress is also synced to the backend.
- Offline images still work using localStorage progress.

## Backend API

- `GET /api/levels` returns level definitions and signed-in user progress.
- `GET /api/levels/images?levelId=beginner&page=1&limit=12` returns images assigned to a level.
- `POST /api/levels/progress` saves a completed image for the signed-in user.

## Storage

Frontend localStorage key:

```text
levelProgressState
```

Backend user document field:

```json
{
  "levelProgress": {
    "completedImagesByLevel": {
      "beginner": ["imageId1"]
    },
    "unlockedLevelIds": ["beginner", "easy-animals"],
    "lastCompletedLevelId": "beginner"
  }
}
```
