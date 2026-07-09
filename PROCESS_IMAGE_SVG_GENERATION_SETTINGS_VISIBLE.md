# Process Image SVG generation settings visibility fix

The uploaded browser generator has a separate Output / SVG generation panel. The backend Process Image page previously only showed a small processing panel, so many SVG output controls were not visible.

## Added visible settings

The root Process Image page now shows a dedicated **SVG generation** section with:

- Show labels
- Fill facets
- Show borders
- Geometry mode
- Shape size
- Jitter
- Edge detail
- Use original colors
- Artistic preset
- Border simplify epsilon
- Stroke color mode
- Inner / outer stroke width
- Stroke opacity
- Non-scaling strokes
- Stroke behind fill
- Label halo
- SVG size multiplier
- Label font size
- Label font color

## Backend support

`/api/process-image/[userId]` now reads these SVG generation fields from form data and uses them for facet SVG output where supported.

Current backend renderer supports **Facets (paint-by-number)**. Low-poly / grid geometry controls are visible for compatibility with the uploaded generator UI, but selecting them returns a clear JSON message instead of silently failing.
