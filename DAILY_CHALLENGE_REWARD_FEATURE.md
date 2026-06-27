# Daily Challenge / Daily Reward Feature

Added backend route:

- `GET /api/daily-challenge`
  - Selects one public `svgdata` image for the current UTC date.
  - Returns the image thumbnail plus reward/streak status for the signed-in user.

- `POST /api/daily-challenge`
  - Body: `{ "imageId": "...", "challengeDate": "YYYY-MM-DD" }`
  - Requires Firebase auth.
  - Idempotent: a user can only receive the daily reward once per day.
  - Adds `DAILY_REWARD_COINS` coins, default `50`.
  - Tracks consecutive streaks.
  - Unlocks `DAILY_SPECIAL_PACK_ID` after `DAILY_STREAK_REWARD_DAYS`, default `7`.

Stored on the `users` collection under `dailyReward`:

```json
{
  "coins": 50,
  "streak": 1,
  "lastClaimDate": "2026-06-27",
  "claimedDates": ["2026-06-27"],
  "unlockedSpecialPacks": []
}
```

Optional environment variables:

```bash
DAILY_REWARD_COINS=50
DAILY_STREAK_REWARD_DAYS=7
DAILY_SPECIAL_PACK_ID=daily-streak-special-pack
DAILY_SPECIAL_PACK_NAME="Special Daily Streak Pack"
```
