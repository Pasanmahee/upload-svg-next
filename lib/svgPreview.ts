const FALLBACK_STROKE = '#000000';

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

/**
 * Pick the first palette colour that remains visible on white. Very light
 * palette colours fall back to black so an automatically generated preview
 * cannot turn into an apparently blank card.
 */
export function choosePreviewStrokeColor(colors: readonly string[], fallback = FALLBACK_STROKE): string {
  for (const value of colors) {
    const color = expandHex(value);
    if (!color) continue;

    const contrastAgainstWhite = 1.05 / (relativeLuminance(color) + 0.05);
    if (contrastAgainstWhite >= 2.25) return color;
  }

  return expandHex(fallback) || FALLBACK_STROKE;
}

function removePaintDeclarations(style: string): string {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => !/^(?:fill|fill-opacity|stroke|stroke-opacity)\s*:/i.test(declaration))
    .join(';');
}

function forceOutlineStyle(attributes: string, strokeColor: string): string {
  const selfClosing = /\/\s*$/.test(attributes);
  let next = attributes.replace(/\/\s*$/, '');

  // Remove presentation attributes that could fight the inline preview style.
  next = next.replace(
    /\s(?:fill|fill-opacity|stroke|stroke-opacity)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    '',
  );

  const forcedPaint = `fill:#FFFFFF!important;stroke:${strokeColor}!important`;
  const stylePattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;

  if (stylePattern.test(next)) {
    next = next.replace(stylePattern, (_match, quote: string, existing: string) => {
      const retained = removePaintDeclarations(existing);
      const combined = retained ? `${retained};${forcedPaint}` : forcedPaint;
      return ` style=${quote}${combined}${quote}`;
    });
  } else {
    next += ` style="${forcedPaint}"`;
  }

  return `${next}${selfClosing ? ' /' : ''}`;
}

/**
 * Convert an uploaded SVG into a safe, high-contrast card preview:
 * white background/fills, one visible outline colour, and no number labels.
 * The result can be rendered by either a browser canvas or Sharp/libvips.
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

  svg = svg.replace(/<svg\b([^>]*)>/i, (_match, attributes: string) => {
    const withNamespace = /\sxmlns\s*=/i.test(attributes)
      ? attributes
      : `${attributes} xmlns="http://www.w3.org/2000/svg"`;
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
    g.label, g.labels, [class*="label"], [id*="label"], text, tspan { display: none !important; }
  </style>`;

  if (/<\/svg\s*>/i.test(svg)) {
    return svg.replace(/<\/svg\s*>\s*$/i, `${finalStyle}</svg>`);
  }

  return `${svg}${finalStyle}</svg>`;
}
