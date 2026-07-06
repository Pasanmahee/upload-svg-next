# Hint Economy API

Adds backend support for daily free hints and coin-based hint usage.

## Routes

### GET /api/hints/status

Returns the current user's hint balance and daily claim state.

```json
{
  "success": true,
  "status": {
    "freeHints": 3,
    "coins": 50,
    "dailyFreeHints": 3,
    "coinCost": 25,
    "maxStoredFreeHints": 9,
    "canClaimDaily": false,
    "claimedToday": true,
    "usedToday": 0,
    "lifetimeUsed": 0,
    "types": []
  }
}
```

### POST /api/hints/claim-daily

Claims the daily free hint grant once per day. The grant is capped by `HINT_MAX_STORED_FREE`.

### POST /api/hints/use

Consumes one hint. Free hints are used first; if none are available, coins are deducted from the existing `dailyReward.coins` balance.

Request:

```json
{
  "type": "highlight_same_number",
  "imageId": "...",
  "levelId": "beginner",
  "clientHintId": "hint-beginner-image-123-1700000000"
}
```

Supported types:

- `find_number`
- `highlight_same_number`
- `auto_fill_area`

The backend records usage in `hintEvents` and stores balances in `users.hintEconomy`.


## Frontend hint target metadata

`POST /api/hints/use` now accepts optional `targetNumber` and `targetFacetCount` values. These are saved only as gameplay metadata/analytics; the backend still controls whether a hint can be spent, while the `/home` frontend controls which SVG/canvas areas are visually highlighted or auto-filled.
