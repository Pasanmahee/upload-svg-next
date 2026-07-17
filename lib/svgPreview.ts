const FALLBACK_STROKE = '#000000';
const PREVIEW_STROKE_WIDTH_PX = 2.2;
const MIN_STRONG_CONTRAST = 4.5;

function expandHex(value: string): string | null {
  const match = String(value || '').trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;

  const hex = match[1].length === 3
    ? match[1].split('').map((part) => part + part).join('')
    : match[1];

  return `#${hex.toUpperCase()}`;
}

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastAgainstWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/**
 * Select the darkest usable palette colour instead of the first barely-visible
 * colour. A colour must meet normal-text contrast against white; otherwise the
 * preview falls back to solid black.
 */
export function choosePreviewStrokeColor(colors: readonly string[], fallback = FALLBACK_STROKE): string {
  const candidates = colors
    .map(expandHex)
    .filter((value): value is string => Boolean(value))
    .map((color) => ({ color, contrast: contrastAgainstWhite(color) }))
    .sort((a, b) => b.contrast - a.contrast);

  if (candidates[0] && candidates[0].contrast >= MIN_STRONG_CONTRAST) {
    return candidates[0].color;
  }

  return expandHex(fallback) || FALLBACK_STROKE;
}

function removePreviewPaintDeclarations(style: string): string {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => !/^(?:fill|fill-opacity|stroke|stroke-opacity|stroke-width|opacity|vector-effect|filter|mix-blend-mode)\s*:/i.test(declaration))
    .join(';');
}

function forceOutlineStyle(attributes: string, strokeColor: string): string {
  const selfClosing = /\/\s*$/.test(attributes);
  let next = attributes.replace(/\/\s*$/, '');

  // Remove source paint, very thin widths, partial opacity and filters that can
  // make the generated thumbnail look pale after SVG/WebP rasterisation.
  next = next.replace(
    /\s(?:fill|fill-opacity|stroke|stroke-opacity|stroke-width|opacity|vector-effect|filter|mix-blend-mode)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    '',
  );

  const forcedPaint = [
    'fill:none!important',
    `stroke:${strokeColor}!important`,
    `stroke-width:${PREVIEW_STROKE_WIDTH_PX}px!important`,
    'stroke-opacity:1!important',
    'opacity:1!important',
    'vector-effect:non-scaling-stroke!important',
    'filter:none!important',
    'mix-blend-mode:normal!important',
  ].join(';');

  const stylePattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;

  if (stylePattern.test(next)) {
    next = next.replace(stylePattern, (_match, quote: string, existing: string) => {
      const retained = removePreviewPaintDeclarations(existing);
      const combined = retained ? `${retained};${forcedPaint}` : forcedPaint;
      return ` style=${quote}${combined}${quote}`;
    });
  } else {
    next += ` style="${forcedPaint}"`;
  }

  return `${next}${selfClosing ? ' /' : ''}`;
}

function clearContainerOpacity(attributes: string): string {
  let next = attributes.replace(
    /\s(?:opacity|fill-opacity|stroke-opacity|filter|mix-blend-mode)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    '',
  );

  const stylePattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;
  if (stylePattern.test(next)) {
    next = next.replace(stylePattern, (_match, quote: string, existing: string) => {
      const retained = removePreviewPaintDeclarations(existing);
      return retained ? ` style=${quote}${retained}${quote}` : '';
    });
  }

  return next;
}

/**
 * Convert an uploaded SVG into a high-contrast card preview: white background,
 * solid dark outlines, no number labels and a fixed non-scaling line width.
 */
export function buildOutlinePreviewSvg(svgSource: string, requestedStroke = FALLBACK_STROKE): string {
  const strokeColor = choosePreviewStrokeColor([requestedStroke]);
  let svg = String(svgSource || '').trim();

  if (!/<svg\b/i.test(svg)) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  }

  // Preview images never need executable or externally embedded content.
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<(?:iframe|object|embed|image)\b[^>]*(?:>[\s\S]*?<\/(?:iframe|object|embed|image)\s*>|\/?>)/gi, '')
    .replace(/<text\b[\s\S]*?<\/text\s*>/gi, '')
    .replace(/<text\b[^>]*\/\s*>/gi, '')
    .replace(/<tspan\b[\s\S]*?<\/tspan\s*>/gi, '')
    .replace(/<tspan\b[^>]*\/\s*>/gi, '');

  // Opacity on a parent group still fades every child, even when each path is
  // forced to full opacity. Remove those inherited fading/filter effects.
  svg = svg.replace(/<(g|a)\b([^>]*)>/gi, (_match, tagName: string, attributes: string) => {
    return `<${tagName}${clearContainerOpacity(attributes)}>`;
  });

  svg = svg.replace(/<svg\b([^>]*)>/i, (_match, attributes: string) => {
    const cleaned = clearContainerOpacity(attributes);
    const withNamespace = /\sxmlns\s*=/i.test(cleaned)
      ? cleaned
      : `${cleaned} xmlns="http://www.w3.org/2000/svg"`;
    return `<svg${withNamespace}><rect data-preview-background="true" width="100%" height="100%" fill="#FFFFFF"/>`;
  });

  svg = svg.replace(
    /<(path|polygon|polyline|rect|circle|ellipse|line|use)\b([^>]*)>/gi,
    (_match, tagName: string, attributes: string) => {
      if (/\bdata-preview-background\s*=/i.test(attributes)) {
        return `<${tagName}${attributes}>`;
      }
      return `<${tagName}${forceOutlineStyle(attributes, strokeColor)}>`;
    },
  );

  const finalStyle = `<style>
    svg { background: #FFFFFF !important; }
    g.label, g.labels, [class*="label"], [id*="label"], text, tspan,
    #border-junctions, [id*="border-junction"] { display: none !important; }
    path, polygon, polyline, rect:not([data-preview-background]), circle, ellipse, line, use {
      fill: none !important;
      stroke: ${strokeColor} !important;
      stroke-width: ${PREVIEW_STROKE_WIDTH_PX}px !important;
      stroke-opacity: 1 !important;
      opacity: 1 !important;
      vector-effect: non-scaling-stroke !important;
      filter: none !important;
      mix-blend-mode: normal !important;
      shape-rendering: geometricPrecision;
    }
  </style>`;

  if (/<\/svg\s*>/i.test(svg)) {
    return svg.replace(/<\/svg\s*>\s*$/i, `${finalStyle}</svg>`);
  }

  return `${svg}${finalStyle}</svg>`;
}
