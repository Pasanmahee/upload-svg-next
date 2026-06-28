# Guest-first progress sync backend

Added `/api/progress/sync`.

The route:
- requires Firebase Authorization
- rejects anonymous users for permanent cloud backup
- merges local level progress into `users.levelProgress`
- merges local daily reward state into `users.dailyReward`
- avoids double-counting coins by taking the larger saved coin total instead of summing duplicate local/server values

Existing routes still allow anonymous Firebase users to save temporary progress:
- `POST /api/levels/progress`
- `POST /api/daily-challenge`

The public reads now mark anonymous auth as `isAnonymous: true` and `signedIn: false`, so the app can keep guest-first UI while still using anonymous backend IDs.
