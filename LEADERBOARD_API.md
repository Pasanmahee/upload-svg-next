# Leaderboard API

Adds leaderboard support for Number Paint / SVG facet coloring.

## Routes

### `GET /api/leaderboards?type=fastest`
Returns the best fastest-time entry per user. Sorting prefers:
1. lowest `timeSeconds`
2. highest `accuracy`
3. lowest `mistakes`
4. lowest `usedHints`

### `GET /api/leaderboards?type=weekly_completed`
Returns users with the most completed pictures during the last 7 days.

### `GET /api/leaderboards?type=streak`
Returns users with the longest daily reward streak.

Optional query:

```txt
limit=10
```

Maximum limit is 50.

### `POST /api/scores`
Stores a leaderboard score linked to a trusted completion event.

Body:

```json
{
  "completionId": "...",
  "clientCompletionId": "completion:beginner:normal:..."
}
```

The backend does **not** trust client-submitted times/accuracy for leaderboards. It loads the matching `/api/completions` record for the authenticated user and copies the score fields from that record. This prevents simple fake leaderboard unlocks.

## Collections

- `completions`: source of truth for completion stats
- `scores`: explicit leaderboard score rows, one per user completion
- `users.dailyReward.streak`: source for streak leaderboard

## Privacy

Leaderboard responses do not expose email addresses or Firebase UIDs. They return a masked `playerName` such as `Player 1234` or a short masked email prefix.
