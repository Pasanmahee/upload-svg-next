import type { RGB } from '@/lib/pbn/common';
import type { FacetResult } from '@/lib/pbn/facetCreator';

export interface SvgOptions {
  sizeMultiplier: number;
  fillFacets: boolean;
  showBorders: boolean;
  showLabels: boolean;
  fontSize?: number;
  fontColor?: string;
}

interface Point {
  x: number;
  y: number;
}

export function rgbToHex(color: number[]): string {
  return `#${((1 << 24) + (color[0] << 16) + (color[1] << 8) + color[2]).toString(16).slice(1).toUpperCase()}`;
}

export function extractColorPalette(colorsByIndex: number[][]): string[] {
  return colorsByIndex.map((c) => rgbToHex(c));
}

/**
 * Converts the computed facets to an SVG string.
 * Ported from the original Express server; intentionally kept compatible with existing downstream clients.
 */
export async function createSVG(
  facetResult: FacetResult,
  colorsByIndex: RGB[],
  options: SvgOptions,
  onUpdate: ((progress: number) => void) | null = null,
): Promise<string> {
  const {
    sizeMultiplier,
    fillFacets,
    showBorders,
    showLabels,
    fontSize = 60,
    fontColor = 'black',
  } = options;

  const xmlns = 'http://www.w3.org/2000/svg';
  const svgWidth = sizeMultiplier * facetResult.width;
  const svgHeight = sizeMultiplier * facetResult.height;

  let svgString = `<?xml version="1.0" standalone="no"?>\n`;
  svgString += `<svg width="${svgWidth}" height="${svgHeight}" xmlns="${xmlns}">`;

  const facets = facetResult.facets;
  for (let idxFacet = 0; idxFacet < facets.length; idxFacet++) {
    const f = facets[idxFacet];
    if (f == null || f.borderSegments.length === 0) continue;

    let newpath: Point[] = [];
    const useSegments = true;

    if (useSegments) {
      newpath = f.getFullPathFromBorderSegments(false) as any;
    } else {
      for (let i = 0; i < f.borderPath.length; i++) {
        newpath.push({
          x: f.borderPath[i].getWallX() + 0.5,
          y: f.borderPath[i].getWallY() + 0.5,
        });
      }
    }

    if (newpath.length < 2) continue;

    // Close path if not already closed
    const first = newpath[0];
    const last = newpath[newpath.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
      newpath.push(first);
    }

    // Build quadratic curve path (smooth-ish)
    let data = 'M ';
    data += `${first.x * sizeMultiplier} ${first.y * sizeMultiplier} `;
    for (let i = 1; i < newpath.length; i++) {
      const midpointX = (newpath[i].x + newpath[i - 1].x) / 2;
      const midpointY = (newpath[i].y + newpath[i - 1].y) / 2;
      data += `Q ${midpointX * sizeMultiplier} ${midpointY * sizeMultiplier} ${newpath[i].x * sizeMultiplier} ${newpath[i].y * sizeMultiplier} `;
    }

    const facetColor = colorsByIndex[f.color];
    const facetRgb = `rgb(${facetColor[0]},${facetColor[1]},${facetColor[2]})`;

    let svgStroke = 'none';
    if (showBorders) {
      svgStroke = '#000';
    } else if (fillFacets) {
      svgStroke = facetRgb;
    }

    const svgFill = fillFacets ? facetRgb : 'none';

    svgString += `<path data-facetId="${f.id}" d="${data}" style="fill: ${svgFill}; stroke: ${svgStroke}; stroke-width: 1px;"></path>`;

    if (showLabels) {
      const labelOffsetX = f.labelBounds.minX * sizeMultiplier;
      const labelOffsetY = f.labelBounds.minY * sizeMultiplier;
      const labelWidth = f.labelBounds.width * sizeMultiplier;
      const labelHeight = f.labelBounds.height * sizeMultiplier;
      const nrOfDigits = String(f.color).length;

      svgString += `
        <g class="label" transform="translate(${labelOffsetX},${labelOffsetY})">
          <svg width="${labelWidth}" height="${labelHeight}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">
            <text font-family="Tahoma" font-size="${fontSize / nrOfDigits}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text>
          </svg>
        </g>`;
    }

    if (onUpdate) {
      onUpdate((idxFacet + 1) / facets.length);
    }
  }

  svgString += '</svg>';
  return svgString;
}
