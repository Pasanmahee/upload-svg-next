# Daily Images level loading repair

Fixes included:

- Level inference no longer randomly assigns unclassified images by index.
- Manual `/game-settings` `levelId` assignments remain the strongest source of truth.
- Keyword grouping still works when no manual assignment exists.
- Images with no assignment and no keyword match are not returned inside Beginner/other level pages.

Admin action:

- Assign public images to the correct levels in `/game-settings`.
- Redeploy backend and clear Vercel build cache if needed.
