# Process Image Button Text Visibility Fix

Fixed the Process Image generated preview action buttons where text could become invisible.

## Cause

The shared `.buttonLink` class forced `color: #fff !important`, while `.secondaryButtonLink` used a white background. The secondary button text stayed white on white.

## Fix

`secondaryButtonLink` now overrides the inherited color with `color: #111827 !important` and also handles hover, visited, active, and focus states.

Affected buttons:

- Download preview
- Download SVG
