# Pack Level Mapping Update

This update adds dynamic Game Settings level to Pack Management mapping.

## New backend behavior

- Packs can now store `mappedLevelIds`.
- Packs can now store `autoSyncLevelImages`.
- Pack manifests merge manually selected `imageIds` plus all public images whose `levelId` matches `mappedLevelIds`, when `autoSyncLevelImages` is enabled.
- New admin API: `POST /api/admin/packs/:packId/level-map`.

## Pack Management UI

The `/pack-management` page now includes a **Level → Pack Mapping** section.

Buttons:

- **Map level to pack**: maps the selected game-settings level to the selected pack and bulk-adds current images from that level.
- **Unmap only**: removes the level mapping but keeps already selected images.
- **Unmap + remove images**: removes the level mapping and removes current images from that level from the pack.
- **Auto-sync mapped levels into manifest**: when enabled, newly assigned images from game-settings automatically appear in the pack manifest.

## Recommended usage

- Beginner level → Starter Free Pack
- Easy Animals level → Rewarded Animal Pack
- Flowers level → Flower Bonus Pack
- Hard Mandala level → Premium Mandala Pack

This reduces manual image selection while still allowing manual override.
