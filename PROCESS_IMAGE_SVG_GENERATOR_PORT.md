# Process Image SVG Generator Port

Updated `/api/process-image/[userId]` to use the important processing logic from the uploaded `svg-generator` project.

## Added to backend processing

- LAB colour clustering is now the default, matching the generator.
- Speckle cleanup after k-means clustering.
- Narrow pixel strip cleanup loop before final facet tracing.
- Server-side support for uploaded-generator style SVG curve mode:
  - `cubic_catmull` for smoother borders.
  - `quadratic_midpoint` legacy fallback.
- SVG output now uses compact rounded coordinates to reduce file size.
- Optional border simplification using RDP.
- Rounded stroke joins/caps and junction caps to reduce noisy joins.
- Label halo support for clearer numbers.
- `data-number` and `data-color-index` attributes on SVG paths for frontend hint/paint logic.
- Processing options are saved in each `svgdata` record under `processOptions`.

## New optional form fields

`POST /api/process-image/[userId]` accepts the existing fields plus these optional fields:

```text
speckleCleanupEnabled=true|false
speckleCleanupRadius=0..3
speckleCleanupPasses=0..5
narrowPixelStripCleanupRuns=0..10
removeFacetsSmallerThanNrOfPoints=number
removeFacetsFromLargeToSmall=true|false
nrOfTimesToHalveBorderSegments=0..8
resizeImageIfTooLarge=true|false
resizeImageWidth=number
resizeImageHeight=number
svgFontSize=number
svgFontColor=#333333
svgCurveMode=cubic_catmull|quadratic_midpoint
borderSimplifyEpsilon=number
strokeColorMode=ink|soft
innerStrokeWidth=number
outerStrokeWidth=number
strokeOpacity=0..1
nonScalingStroke=true|false
paintOrderStrokeFill=true|false
labelHalo=true|false
```

## Default settings added

`settings.json` now includes the generator-inspired defaults:

```json
{
  "kMeansClusteringColorSpace": 2,
  "speckleCleanupEnabled": true,
  "speckleCleanupRadius": 1,
  "speckleCleanupPasses": 1,
  "svgCurveMode": "cubic_catmull",
  "paintOrderStrokeFill": true,
  "labelHalo": true
}
```

## Notes

The uploaded browser generator depends on DOM/canvas APIs, so it was not copied directly into Next.js server code. The reusable algorithmic parts were ported into the existing server-side Sharp + facet pipeline.
