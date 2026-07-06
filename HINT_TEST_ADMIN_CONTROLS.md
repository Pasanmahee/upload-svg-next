# Hint Test Admin Controls

Added backend-only admin test tools for the hint economy.

## New API

### GET `/api/admin/hints?userId=<firebaseUid>`
Loads a user's hint status and recent hint events.

### GET `/api/admin/hints?email=<email>`
Alternative lookup by saved email/parentEmail when available. Firebase UID is more reliable.

### PATCH `/api/admin/hints`
Admin-only endpoint to edit test values.

Example set count:

```json
{
  "userId": "firebase-uid",
  "freeHints": 9,
  "coins": 500
}
```

Example reset for testing:

```json
{
  "userId": "firebase-uid",
  "action": "reset",
  "resetHints": true
}
```

Reset behavior:
- sets free hints to `HINT_DAILY_FREE`
- clears today's hint claim lock
- clears today's hint use count
- keeps lifetime stats for analytics

## Admin UI

The `/game-settings` backend page now has a **Hint Testing** section with:
- Firebase UID/email lookup
- free hint count editor
- coin count editor
- reset hints button
- recent hint event preview

This is for testing only and is protected by the existing admin auth used by `/api/admin/*` routes.
