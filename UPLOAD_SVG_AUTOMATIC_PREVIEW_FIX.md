# Upload SVG Automatic Preview Fix

## Fixed behaviour

The **Attach a separate image file (JPG/PNG/WebP)** option now only controls whether a custom raster image replaces the automatic preview.

- When unchecked, the browser automatically renders the selected SVG to a WebP/PNG preview and uploads it with the SVG.
- When checked, the selected JPG/PNG/WebP image is used as the preview.
- The API still generates a WebP preview directly from the original SVG when browser-side preview creation is unavailable.
- Unchecking the option no longer deletes a previously selected custom image from component state.

This ensures newly uploaded records always contain `pngData` for Manage Images, packs, levels, and the game UI.
