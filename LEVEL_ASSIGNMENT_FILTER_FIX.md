# Level Assignment Filter Fix

Fixed a bug where images manually assigned to a later level, such as Expert, could still appear in Beginner because stale cached/auto keyword grouping was used by the app.

Changes:
- Manual `levelId` now overrides keyword/index fallback more strictly.
- Level IDs are normalized consistently, including casing/spacing.
- Frontend applies the level filter before category filters when reading cached data.
- Level API responses are safety-filtered again on the frontend before display.
- Pull-to-refresh clears cached level/image responses so admin changes show immediately.

After deploying backend and reinstalling the app, use Refresh on the landing page if old cached items are still visible.
