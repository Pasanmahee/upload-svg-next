# Hint Email Lookup Fix

Fixed the backend admin Hint Testing tool where Firebase UID updates worked but email-based hint count updates could fail.

## What changed

- Email lookup now uses case-insensitive matching.
- Email lookup checks more user fields: `email`, `userEmail`, `parentEmail`, `profile.email`, `firebaseEmail`, `authEmail`, and `emailLower`.
- If the email is not stored in `users`, the admin route now tries to resolve the UID from previous activity collections such as completions, hint events, and scores.
- If still not found, the admin route tries Firebase Admin `getUserByEmail(email)` to resolve the UID.
- PATCH updates now write to the resolved UID, not an unreliable email-only target.
- Hint use, daily hint claim, and completion updates now save `email` and `emailLower` into the user document when Firebase auth provides an email, so future email lookup works reliably.
- The Game Settings admin UI now prefers the resolved UID after loading a user by email, so Save/Reset acts on the correct user record.

## Admin route

`GET /api/admin/hints?email=user@example.com`

`PATCH /api/admin/hints`

```json
{
  "email": "user@example.com",
  "freeHints": 9,
  "coins": 500
}
```

For best reliability, first click **Load Hint Status** with the email. The UI will resolve the UID, then Save/Reset will use that resolved UID.
