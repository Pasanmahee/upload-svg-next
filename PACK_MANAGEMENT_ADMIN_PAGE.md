# Pack Management Admin Page

Added a separate backend admin page at `/pack-management`.

## What it does

- Lists all packs from the `packs` collection.
- Creates new packs.
- Edits pack title, description, cover image URL, unlock type, coin price, streak requirement, achievement requirement, sort order, active status, and size estimate.
- Assigns images to packs by checking image cards.
- Filters images by level or unassigned state.
- Adds/removes all currently filtered images in one click.
- Opens the generated user manifest for the selected pack.
- Disables packs through the existing soft-delete admin API.

## Changed files

- `app/pack-management/page.tsx`
- `components/AuthBar.tsx`
- `app/page.tsx`
- `app/globals.css`
- `app/api/admin/packs/route.ts`
- `app/api/admin/packs/[packId]/route.ts`
- `app/api/admin/packs/[packId]/images/route.ts`

## Notes

The admin pack APIs now return `imageIds` for admin use. Public pack APIs still expose only safe pack metadata and generated manifests.

Run:

```bash
npm ci
npm run build
```

Build was verified successfully after this update.
