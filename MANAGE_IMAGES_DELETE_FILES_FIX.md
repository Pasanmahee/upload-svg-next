# Manage Images deletion fix

The Manage Images page now has a visible Delete button on every image card.

Deleting an image now:

- verifies admin or owner access;
- deletes the stored SVG, preview image and simplified SVG from Google Cloud Storage;
- deletes the MongoDB `svgdata` record;
- removes the image ID from pack `imageIds`;
- removes manual daily challenge mappings that reference the image;
- keeps the database record when a managed storage file cannot be deleted, allowing the operation to be retried; and
- updates the page immediately after successful deletion.

The legacy `/api/deleteimage` route remains for backward compatibility, while Manage Images now uses `DELETE /api/images/:id`.
