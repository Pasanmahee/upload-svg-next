import type { RGB } from '@/lib/pbn/common';
import type { FacetResult } from '@/lib/pbn/facetCreator';

export interface SvgArtisticOptions {
  borderSimplifyEpsilon?: number;
  strokeColorMode?: 'ink' | 'soft' | string;
  innerStrokeWidth?: number;
  outerStrokeWidth?: number;
  strokeOpacity?: number;
  nonScalingStroke?: boolean;
  paintOrderStrokeFill?: boolean;
  labelHalo?: boolean;
}

export interface SvgOptions {
  sizeMultiplier: number;
  fillFacets: boolean;
  showBorders: boolean;
  showLabels: boolean;
  fontSize?: number;
  fontColor?: string;
  curveMode?: 'quadratic_midpoint' | 'cubic_catmull' | string;
  artistic?: SvgArtisticOptions | null;
}

interface Point {
  x: number;
  y: number;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fmt(v: number): string {
  // Compact SVG output like the uploaded browser generator. Two decimals are
  // enough for smooth 1px borders and keep backend documents small.
  return (Math.round(v * 100) / 100).toString();
}

function pointEquals(a?: Point, b?: Point): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

function perpDist(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  const projx = a.x + t * vx;
  const projy = a.y + t * vy;
  return Math.hypot(p.x - projx, p.y - projy);
}

function rdp(pts: Point[], eps: number): Point[] {
  if (!pts || pts.length < 3) return pts;
  let dmax = 0;
  let index = 0;
  const end = pts.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDist(pts[i], pts[0], pts[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > eps) {
    const rec1 = rdp(pts.slice(0, index + 1), eps);
    const rec2 = rdp(pts.slice(index), eps);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  }
  return [pts[0], pts[end]];
}

function buildQuadraticPath(newpath: Point[], sizeMultiplier: number): string {
  let data = `M ${fmt(newpath[0].x * sizeMultiplier)} ${fmt(newpath[0].y * sizeMultiplier)} `;
  for (let i = 1; i < newpath.length; i++) {
    const midpointX = (newpath[i].x + newpath[i - 1].x) / 2;
    const midpointY = (newpath[i].y + newpath[i - 1].y) / 2;
    data += `Q ${fmt(midpointX * sizeMultiplier)} ${fmt(midpointY * sizeMultiplier)} ${fmt(newpath[i].x * sizeMultiplier)} ${fmt(newpath[i].y * sizeMultiplier)} `;
  }
  return data;
}

function cornerFactor(pa: Point, pb: Point, pc: Point): number {
  const v1x = pb.x - pa.x;
  const v1y = pb.y - pa.y;
  const v2x = pc.x - pb.x;
  const v2y = pc.y - pb.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return 1;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  const c = Math.max(-1, Math.min(1, cos));
  const ang = Math.acos(c) * 180 / Math.PI;
  const minAng = 60;
  const maxAng = 150;
  if (ang <= minAng) return 0.25;
  if (ang >= maxAng) return 1;
  return 0.25 + (ang - minAng) * (1 - 0.25) / (maxAng - minAng);
}

function buildCubicCatmullPath(newpath: Point[], sizeMultiplier: number): string {
  let pts = newpath;
  if (pts.length > 1 && pointEquals(pts[0], pts[pts.length - 1])) {
    pts = pts.slice(0, pts.length - 1);
  }
  if (pts.length < 4) return buildQuadraticPath(newpath, sizeMultiplier);

  let data = `M ${fmt(pts[0].x * sizeMultiplier)} ${fmt(pts[0].y * sizeMultiplier)} `;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const f1 = cornerFactor(p0, p1, p2);
    const f2 = cornerFactor(p1, p2, p3);
    const c1x = p1.x + ((p2.x - p0.x) / 6) * f1;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * f1;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * f2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * f2;
    data += `C ${fmt(c1x * sizeMultiplier)} ${fmt(c1y * sizeMultiplier)} ${fmt(c2x * sizeMultiplier)} ${fmt(c2y * sizeMultiplier)} ${fmt(p2.x * sizeMultiplier)} ${fmt(p2.y * sizeMultiplier)} `;
  }
  return data;
}

function buildOpenCubicCatmullPath(points: Point[], sizeMultiplier: number): string {
  if (points.length < 3) {
    return buildQuadraticPath(points, sizeMultiplier);
  }

  let data = `M ${fmt(points[0].x * sizeMultiplier)} ${fmt(points[0].y * sizeMultiplier)} `;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const f1 = cornerFactor(p0, p1, p2);
    const f2 = cornerFactor(p1, p2, p3);
    const c1x = p1.x + ((p2.x - p0.x) / 6) * f1;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * f1;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * f2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * f2;
    data += `C ${fmt(c1x * sizeMultiplier)} ${fmt(c1y * sizeMultiplier)} ${fmt(c2x * sizeMultiplier)} ${fmt(c2y * sizeMultiplier)} ${fmt(p2.x * sizeMultiplier)} ${fmt(p2.y * sizeMultiplier)} `;
  }
  return data;
}

function buildOpenPath(points: Point[], sizeMultiplier: number, curveMode: string): string {
  return curveMode === 'cubic_catmull'
    ? buildOpenCubicCatmullPath(points, sizeMultiplier)
    : buildQuadraticPath(points, sizeMultiplier);
}

function buildFacetPointPath(
  facet: any,
  segmentPoints: Map<any, Point[]>,
): Point[] {
  const path: Point[] = [];
  const addPoint = (point: Point) => {
    const previous = path[path.length - 1];
    if (!previous || !pointEquals(previous, point)) {
      path.push({ x: point.x, y: point.y });
    }
  };

  let lastSegment: any = null;
  for (const segment of facet.borderSegments || []) {
    const points = segmentPoints.get(segment.originalSegment) || segment.originalSegment?.points || [];
    if (lastSegment) {
      const lastPoints = segmentPoints.get(lastSegment.originalSegment) || lastSegment.originalSegment?.points || [];
      if (lastPoints.length > 0) {
        addPoint(lastSegment.reverseOrder ? lastPoints[0] : lastPoints[lastPoints.length - 1]);
      }
    }

    if (segment.reverseOrder) {
      for (let i = points.length - 1; i >= 0; i--) addPoint(points[i]);
    } else {
      for (const point of points) addPoint(point);
    }
    lastSegment = segment;
  }
  return path;
}

function darkenedAverageColor(colors: RGB[]): string {
  if (colors.length === 0) return '#000';
  const totals = colors.reduce(
    (sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]],
    [0, 0, 0],
  );
  const r = Math.round((totals[0] / colors.length) * 0.45);
  const g = Math.round((totals[1] / colors.length) * 0.45);
  const b = Math.round((totals[2] / colors.length) * 0.45);
  return `rgb(${r},${g},${b})`;
}

export function rgbToHex(color: number[]): string {
  return `#${((1 << 24) + (color[0] << 16) + (color[1] << 8) + color[2]).toString(16).slice(1).toUpperCase()}`;
}

export function extractColorPalette(colorsByIndex: number[][]): string[] {
  return colorsByIndex.map((c) => rgbToHex(c));
}

/**
 * Converts computed facets to an SVG string. This now mirrors the uploaded
 * browser SVG generator's smoother output: compact numeric formatting,
 * shared-segment RDP simplification, Catmull-Rom cubic curves, separate fill,
 * unique-border and label layers, rounded strokes, label halos, and junction caps.
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
    curveMode = 'cubic_catmull',
    artistic = null,
  } = options;

  const xmlns = 'http://www.w3.org/2000/svg';
  const svgWidth = sizeMultiplier * facetResult.width;
  const svgHeight = sizeMultiplier * facetResult.height;

  const art = artistic || {};
  const borderSimplifyEpsilon = typeof art.borderSimplifyEpsilon === 'number' ? art.borderSimplifyEpsilon : 0;
  const strokeColorMode = art.strokeColorMode ? String(art.strokeColorMode) : 'ink';
  const innerStrokeWidth = typeof art.innerStrokeWidth === 'number' ? art.innerStrokeWidth : 1;
  const outerStrokeWidth = typeof art.outerStrokeWidth === 'number' ? art.outerStrokeWidth : innerStrokeWidth;
  const strokeOpacityClamped = clamp01(typeof art.strokeOpacity === 'number' ? art.strokeOpacity : 1);
  const nonScalingStroke = !!art.nonScalingStroke;
  const paintOrderStrokeFill = !!art.paintOrderStrokeFill;
  const labelHalo = !!art.labelHalo;

  let svgString = `<?xml version="1.0" standalone="no"?>\n`;
  svgString += `<svg width="${fmt(svgWidth)}" height="${fmt(svgHeight)}" viewBox="0 0 ${fmt(svgWidth)} ${fmt(svgHeight)}" xmlns="${xmlns}" shape-rendering="geometricPrecision" preserveAspectRatio="xMidYMid meet">`;

  const facets = facetResult.facets;
  const segmentPoints = new Map<any, Point[]>();
  const segmentUsages = new Map<any, {
    source: any;
    colors: RGB[];
    facetIds: Set<number>;
  }>();

  for (const facet of facets as any[]) {
    if (!facet?.borderSegments) continue;
    const facetColor = colorsByIndex[facet.color] || ([255, 255, 255] as RGB);
    for (const wrapper of facet.borderSegments) {
      const source = wrapper?.originalSegment;
      if (!source?.points || source.points.length < 2) continue;

      if (!segmentPoints.has(source)) {
        const originalPoints = source.points.map((point: Point) => ({ x: point.x, y: point.y }));
        const simplified = borderSimplifyEpsilon > 0 && originalPoints.length > 2
          ? rdp(originalPoints, borderSimplifyEpsilon)
          : originalPoints;
        segmentPoints.set(source, simplified.length >= 2 ? simplified : originalPoints);
      }

      let usage = segmentUsages.get(source);
      if (!usage) {
        usage = { source, colors: [], facetIds: new Set<number>() };
        segmentUsages.set(source, usage);
      }
      if (!usage.facetIds.has(facet.id)) {
        usage.facetIds.add(facet.id);
        usage.colors.push(facetColor);
      }
    }
  }

  let fillMarkup = '';
  let labelMarkup = '';
  let count = 0;
  for (const f of facets as any[]) {
    if (f == null || f.borderSegments.length === 0) {
      count++;
      continue;
    }

    let newpath = buildFacetPointPath(f, segmentPoints);
    if (!newpath || newpath.length < 2) {
      count++;
      continue;
    }

    if (!pointEquals(newpath[0], newpath[newpath.length - 1])) {
      newpath = newpath.concat([newpath[0]]);
    }

    let data = curveMode === 'cubic_catmull'
      ? buildCubicCatmullPath(newpath, sizeMultiplier)
      : buildQuadraticPath(newpath, sizeMultiplier);
    data += 'Z';

    const fillRgb = colorsByIndex[f.color] || [255, 255, 255];
    const fillColor = `rgb(${fillRgb[0]},${fillRgb[1]},${fillRgb[2]})`;
    const seamStroke = !showBorders && fillFacets ? fillColor : 'none';

    const pathAttrs = [
      'class="facet"',
      `data-facetId="${escapeAttr(String(f.id))}"`,
      `data-color-index="${escapeAttr(String(f.color))}"`,
      `data-number="${escapeAttr(String(f.color))}"`,
      `d="${escapeAttr(data)}"`,
      `fill="${fillFacets ? fillColor : 'none'}"`,
      `stroke="${seamStroke}"`,
      `stroke-opacity="1"`,
      `stroke-width="${seamStroke === 'none' ? '0' : '1px'}"`,
      `stroke-linejoin="round"`,
      `stroke-linecap="round"`,
      `stroke-miterlimit="1"`,
    ];
    if (!fillFacets) pathAttrs.push('pointer-events="all"');
    if (seamStroke !== 'none' && nonScalingStroke) pathAttrs.push('vector-effect="non-scaling-stroke"');
    if (seamStroke !== 'none' && paintOrderStrokeFill) pathAttrs.push('paint-order="stroke fill"');
    fillMarkup += `<path ${pathAttrs.join(' ')}></path>`;

    if (showLabels && f.labelBounds) {
      const nrOfDigits = String(f.color).length;
      const labelOffsetX = f.labelBounds.minX * sizeMultiplier;
      const labelOffsetY = f.labelBounds.minY * sizeMultiplier;
      const labelWidth = f.labelBounds.width * sizeMultiplier;
      const labelHeight = f.labelBounds.height * sizeMultiplier;
      const labelStroke = labelHalo
        ? ` stroke="#fff" stroke-width="${fmt(Math.max(2, fontSize / 18))}" paint-order="stroke fill" stroke-linejoin="round"`
        : '';
      labelMarkup += `<g class="label" data-number="${escapeAttr(String(f.color))}" transform="translate(${fmt(labelOffsetX)},${fmt(labelOffsetY)})">`;
      labelMarkup += `<svg width="${fmt(labelWidth)}" height="${fmt(labelHeight)}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">`;
      labelMarkup += `<text font-family="Tahoma" font-size="${fmt(fontSize / nrOfDigits)}" dominant-baseline="middle" text-anchor="middle" fill="${escapeAttr(fontColor)}"${labelStroke}>${escapeAttr(String(f.color))}</text>`;
      labelMarkup += `</svg></g>`;
    }

    if (onUpdate && count % 100 === 0) {
      onUpdate((count + 1) / facets.length);
    }
    count++;
  }

  svgString += `<g id="fills">${fillMarkup}</g>`;

  let borderMarkup = '';
  if (showBorders) {
    const counts = new Map<string, number>();
    const pointsByKey = new Map<string, Point>();
    const keyOf = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
    const add = (p: Point) => {
      const k = keyOf(p);
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!pointsByKey.has(k)) pointsByKey.set(k, p);
    };

    let borderIndex = 0;
    for (const usage of segmentUsages.values()) {
      const points = segmentPoints.get(usage.source) || [];
      if (points.length < 2) continue;
      const isOuter = usage.source.neighbour === -1;
      const strokeWidth = Math.max(0.1, isOuter ? outerStrokeWidth : innerStrokeWidth);
      const strokeColor = strokeColorMode === 'soft' && fillFacets
        ? darkenedAverageColor(usage.colors)
        : '#000';
      const borderAttrs = [
        'class="border"',
        `data-border-index="${borderIndex}"`,
        `data-outer="${isOuter ? 'true' : 'false'}"`,
        `d="${escapeAttr(buildOpenPath(points, sizeMultiplier, curveMode))}"`,
        'fill="none"',
        `stroke="${strokeColor}"`,
        `stroke-opacity="${strokeOpacityClamped}"`,
        `stroke-width="${fmt(strokeWidth)}px"`,
        'stroke-linejoin="round"',
        'stroke-linecap="round"',
        'stroke-miterlimit="1"',
      ];
      if (nonScalingStroke) borderAttrs.push('vector-effect="non-scaling-stroke"');
      borderMarkup += `<path ${borderAttrs.join(' ')}></path>`;
      add(points[0]);
      add(points[points.length - 1]);
      borderIndex++;
    }

    let caps = '';
    const joinRadius = Math.max(0.1, innerStrokeWidth / 2);
    for (const [k, c] of counts.entries()) {
      if (c >= 3) {
        const p = pointsByKey.get(k);
        if (!p) continue;
        caps += `<circle cx="${fmt(p.x * sizeMultiplier)}" cy="${fmt(p.y * sizeMultiplier)}" r="${fmt(joinRadius)}" fill="#000" fill-opacity="${strokeColorMode !== 'ink' ? strokeOpacityClamped * 0.6 : strokeOpacityClamped}"></circle>`;
      }
    }
    if (caps) borderMarkup += `<g id="border-junctions">${caps}</g>`;
  }

  svgString += `<g id="borders" pointer-events="none">${borderMarkup}</g>`;
  svgString += `<g id="labels">${labelMarkup}</g>`;

  if (onUpdate) onUpdate(1);
  svgString += '</svg>';
  return svgString;
}
