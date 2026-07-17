# Strong outline preview fix

The automatic SVG preview previously changed only the stroke colour. It kept the source SVG's very thin stroke width, inherited group opacity, and filters. A 0.4–0.5 px non-scaling stroke is mostly anti-aliased when rasterised, so black lines appeared light grey.

The preview renderer now:

- selects the darkest palette colour with at least 4.5:1 contrast against white, otherwise uses black;
- forces a 2.2 px non-scaling stroke;
- forces full stroke and element opacity;
- removes inherited opacity, filters, and blend modes from SVG groups;
- hides border-junction helper dots and number labels;
- keeps a pure white background and lossless WebP optimisation for line art.
