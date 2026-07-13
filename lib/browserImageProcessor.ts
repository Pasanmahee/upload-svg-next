'use client';

import { ColorReducer } from '@/lib/pbn/colorreductionmanagement';
import { FacetCreator } from '@/lib/pbn/facetCreator';
import { FacetReducer } from '@/lib/pbn/facetReducer';
import { FacetBorderTracer } from '@/lib/pbn/facetBorderTracer';
import { FacetBorderSegmenter } from '@/lib/pbn/facetBorderSegmenter';
import { FacetLabelPlacer } from '@/lib/pbn/facetLabelPlacer';
import { ClusteringColorSpace, Settings } from '@/lib/pbn/settings';
import { createSVG, extractColorPalette } from '@/lib/pbnSvg';

export type GeometryMode = 'facets' | 'triangles' | 'triangles_sym' | 'squares' | 'hex' | 'mixed';
export type ArtisticPreset = 'classic' | 'stained_glass' | 'soft_ink' | 'poster_flat' | 'low_poly' | 'low_poly_sym';

export type BrowserProcessSettings = {
  kMeansNrOfClusters: number;
  kMeansMinDeltaDifference: number;
  kMeansClusteringColorSpace: number;
  maximumNumberOfFacets: number;
  removeFacetsSmallerThanNrOfPoints: number;
  removeFacetsFromLargeToSmall: boolean;
  narrowPixelStripCleanupRuns: number;
  nrOfTimesToHalveBorderSegments: number;
  resizeImageIfTooLarge: boolean;
  resizeImageWidth: number;
  resizeImageHeight: number;
  speckleCleanupEnabled: boolean;
  speckleCleanupRadius: number;
  speckleCleanupPasses: number;

  showLabels: boolean;
  fillFacets: boolean;
  showBorders: boolean;
  geometryMode: GeometryMode;
  geoCellSize: number;
  geoJitter: number;
  geoEdgeStrength: number;
  geoUseSourceColor: boolean;
  artisticPreset: ArtisticPreset;
  svgSizeMultiplier: number;
  svgFontSize: number;
  svgFontColor: string;
  svgCurveMode: 'cubic_catmull' | 'quadratic_midpoint';
  borderSimplifyEpsilon: number;
  strokeColorMode: 'ink' | 'soft';
  innerStrokeWidth: number;
  outerStrokeWidth: number;
  strokeOpacity: number;
  nonScalingStroke: boolean;
  paintOrderStrokeFill: boolean;
  labelHalo: boolean;
  debug: boolean;
};

export type BrowserProcessProgress = {
  stage:
    | 'decoding'
    | 'clustering'
    | 'speckle-cleanup'
    | 'facet-creation'
    | 'facet-reduction'
    | 'border-tracing'
    | 'border-segmentation'
    | 'label-placement'
    | 'svg-generation'
    | 'preview-generation'
    | 'completed';
  label: string;
  progress: number;
};

export type BrowserProcessResult = {
  svgString: string;
  svgBlob: Blob;
  previewBlob: Blob;
  previewContentType: string;
  previewExt: 'webp' | 'png';
  colors: string[];
  processOptions: Record<string, unknown>;
  width: number;
  height: number;
  elapsedMs: number;
};

type ProgressCallback = (progress: BrowserProcessProgress) => void;

function report(onProgress: ProgressCallback | undefined, progress: BrowserProcessProgress) {
  onProgress?.({ ...progress, progress: Math.max(0, Math.min(100, Math.round(progress.progress))) });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function decodeImageToImageData(file: File, settings: BrowserProcessSettings): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  try {
    let width = bitmap.width;
    let height = bitmap.height;

    if (
      settings.resizeImageIfTooLarge &&
      (width > settings.resizeImageWidth || height > settings.resizeImageHeight)
    ) {
      const scale = Math.min(
        settings.resizeImageWidth / width,
        settings.resizeImageHeight / height,
        1,
      );
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser could not create a 2D canvas context.');

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function svgToPreview(svgBlob: Blob): Promise<{ blob: Blob; contentType: string; ext: 'webp' | 'png' }> {
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The browser could not render the generated SVG preview.'));
    });

    const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const maxDimension = 1024;
    const scale = Math.min(maxDimension / naturalWidth, maxDimension / naturalHeight, 1);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not create a preview canvas.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    const webp = await canvasToBlob(canvas, 'image/webp', 0.84);
    if (webp && webp.type === 'image/webp') {
      return { blob: webp, contentType: 'image/webp', ext: 'webp' };
    }

    const png = await canvasToBlob(canvas, 'image/png');
    if (!png) throw new Error('The browser could not create the generated image preview.');
    return { blob: png, contentType: 'image/png', ext: 'png' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildPbnSettings(input: BrowserProcessSettings): Settings {
  const settings = new Settings();
  settings.kMeansNrOfClusters = Math.max(2, Math.min(64, Math.floor(input.kMeansNrOfClusters)));
  settings.kMeansMinDeltaDifference = Math.max(0.01, input.kMeansMinDeltaDifference);
  settings.kMeansClusteringColorSpace = input.kMeansClusteringColorSpace as ClusteringColorSpace;
  settings.maximumNumberOfFacets = Math.max(1, Math.floor(input.maximumNumberOfFacets));
  settings.removeFacetsSmallerThanNrOfPoints = Math.max(1, Math.floor(input.removeFacetsSmallerThanNrOfPoints));
  settings.removeFacetsFromLargeToSmall = input.removeFacetsFromLargeToSmall;
  settings.narrowPixelStripCleanupRuns = Math.max(0, Math.min(10, Math.floor(input.narrowPixelStripCleanupRuns)));
  settings.nrOfTimesToHalveBorderSegments = Math.max(0, Math.min(8, Math.floor(input.nrOfTimesToHalveBorderSegments)));
  settings.resizeImageIfTooLarge = input.resizeImageIfTooLarge;
  settings.resizeImageWidth = Math.max(64, Math.floor(input.resizeImageWidth));
  settings.resizeImageHeight = Math.max(64, Math.floor(input.resizeImageHeight));
  settings.speckleCleanupEnabled = input.speckleCleanupEnabled;
  settings.speckleCleanupRadius = Math.max(0, Math.min(3, Math.floor(input.speckleCleanupRadius)));
  settings.speckleCleanupPasses = Math.max(0, Math.min(5, Math.floor(input.speckleCleanupPasses)));
  settings.svgCurveMode = input.svgCurveMode;
  return settings;
}

export async function processImageInBrowser(
  file: File,
  input: BrowserProcessSettings,
  onProgress?: ProgressCallback,
): Promise<BrowserProcessResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Browser image processing is only available in the web browser.');
  }
  if (input.geometryMode !== 'facets') {
    throw new Error('Browser processing currently supports Facets (paint-by-number) geometry only.');
  }

  const startedAt = performance.now();
  const settings = buildPbnSettings(input);

  report(onProgress, { stage: 'decoding', label: 'Reading and resizing image in browser', progress: 3 });
  const imgData = await decodeImageToImageData(file, input);
  await nextPaint();

  const kmeansImgData = new ImageData(imgData.width, imgData.height);
  report(onProgress, { stage: 'clustering', label: 'Reducing image colours', progress: 10 });
  await ColorReducer.applyKMeansClustering(
    imgData,
    kmeansImgData,
    {} as CanvasRenderingContext2D,
    settings,
    () => report(onProgress, { stage: 'clustering', label: 'Reducing image colours', progress: 22 }),
  );
  report(onProgress, { stage: 'clustering', label: 'Colour clustering completed', progress: 28 });

  const colormapResult = ColorReducer.createColorMap(kmeansImgData);
  if (settings.speckleCleanupEnabled && settings.speckleCleanupRadius > 0 && settings.speckleCleanupPasses > 0) {
    report(onProgress, { stage: 'speckle-cleanup', label: 'Removing isolated colour speckles', progress: 31 });
    await ColorReducer.processSpeckleCleanup(
      colormapResult,
      settings.speckleCleanupRadius,
      settings.speckleCleanupPasses,
    );
  }

  let facetResult: Awaited<ReturnType<typeof FacetCreator.getFacets>> | null = null;
  const cleanupRuns = settings.narrowPixelStripCleanupRuns;
  const totalBuilds = Math.max(1, cleanupRuns);

  const buildAndReduce = async (iteration: number) => {
    const iterationSpan = 25 / totalBuilds;
    const iterationStart = 34 + (iteration - 1) * iterationSpan;
    const creationSpan = iterationSpan * 0.42;
    const reductionStart = iterationStart + iterationSpan * 0.48;
    const reductionSpan = iterationSpan * 0.52;

    report(onProgress, { stage: 'facet-creation', label: `Creating facets (${iteration}/${totalBuilds})`, progress: iterationStart });
    const result = await FacetCreator.getFacets(
      imgData.width,
      imgData.height,
      colormapResult.imgColorIndices,
      (p) => report(onProgress, {
        stage: 'facet-creation',
        label: `Creating facets (${iteration}/${totalBuilds})`,
        progress: iterationStart + p * creationSpan,
      }),
    );

    report(onProgress, { stage: 'facet-reduction', label: `Reducing facets (${iteration}/${totalBuilds})`, progress: reductionStart });
    await FacetReducer.reduceFacets(
      settings.removeFacetsSmallerThanNrOfPoints,
      settings.removeFacetsFromLargeToSmall,
      settings.maximumNumberOfFacets,
      colormapResult.colorsByIndex,
      result,
      colormapResult.imgColorIndices,
      (p) => report(onProgress, {
        stage: 'facet-reduction',
        label: `Reducing facets (${iteration}/${totalBuilds})`,
        progress: reductionStart + p * reductionSpan,
      }),
    );
    return result;
  };

  if (cleanupRuns === 0) {
    facetResult = await buildAndReduce(1);
  } else {
    for (let run = 0; run < cleanupRuns; run += 1) {
      report(onProgress, {
        stage: 'facet-reduction',
        label: `Cleaning narrow pixel strips (${run + 1}/${cleanupRuns})`,
        progress: 33 + (run / cleanupRuns) * 25,
      });
      await ColorReducer.processNarrowPixelStripCleanup(colormapResult);
      facetResult = await buildAndReduce(run + 1);
    }
  }

  if (!facetResult) throw new Error('Facet generation did not return a result.');

  report(onProgress, { stage: 'border-tracing', label: 'Tracing facet borders', progress: 62 });
  await FacetBorderTracer.buildFacetBorderPaths(
    facetResult,
    (p) => report(onProgress, { stage: 'border-tracing', label: 'Tracing facet borders', progress: 62 + p * 8 }),
  );

  report(onProgress, { stage: 'border-segmentation', label: 'Smoothing and segmenting borders', progress: 71 });
  await FacetBorderSegmenter.buildFacetBorderSegments(
    facetResult,
    settings.nrOfTimesToHalveBorderSegments,
    (p) => report(onProgress, { stage: 'border-segmentation', label: 'Smoothing and segmenting borders', progress: 71 + p * 8 }),
  );

  report(onProgress, { stage: 'label-placement', label: 'Placing paint numbers', progress: 80 });
  await FacetLabelPlacer.buildFacetLabelBounds(
    facetResult,
    (p) => report(onProgress, { stage: 'label-placement', label: 'Placing paint numbers', progress: 80 + p * 6 }),
  );

  report(onProgress, { stage: 'svg-generation', label: 'Generating SVG in browser', progress: 87 });
  const artistic = {
    borderSimplifyEpsilon: input.borderSimplifyEpsilon,
    strokeColorMode: input.strokeColorMode,
    innerStrokeWidth: input.innerStrokeWidth,
    outerStrokeWidth: input.outerStrokeWidth,
    strokeOpacity: input.strokeOpacity,
    nonScalingStroke: input.nonScalingStroke,
    paintOrderStrokeFill: input.paintOrderStrokeFill,
    labelHalo: input.labelHalo,
  };

  const svgString = await createSVG(
    facetResult,
    colormapResult.colorsByIndex,
    {
      sizeMultiplier: input.svgSizeMultiplier,
      fillFacets: input.fillFacets,
      showBorders: input.showBorders,
      showLabels: input.showLabels,
      fontSize: input.svgFontSize,
      fontColor: input.svgFontColor,
      curveMode: input.svgCurveMode,
      artistic,
    },
    (p) => report(onProgress, { stage: 'svg-generation', label: 'Generating SVG in browser', progress: 87 + p * 6 }),
  );

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  report(onProgress, { stage: 'preview-generation', label: 'Creating browser preview', progress: 94 });
  const preview = await svgToPreview(svgBlob);
  const colors = extractColorPalette(colormapResult.colorsByIndex);

  const processOptions = {
    processingLocation: 'browser',
    sourceWidth: imgData.width,
    sourceHeight: imgData.height,
    kMeansNrOfClusters: settings.kMeansNrOfClusters,
    kMeansMinDeltaDifference: settings.kMeansMinDeltaDifference,
    kMeansClusteringColorSpace: settings.kMeansClusteringColorSpace,
    speckleCleanupEnabled: settings.speckleCleanupEnabled,
    speckleCleanupRadius: settings.speckleCleanupRadius,
    speckleCleanupPasses: settings.speckleCleanupPasses,
    narrowPixelStripCleanupRuns: settings.narrowPixelStripCleanupRuns,
    removeFacetsSmallerThanNrOfPoints: settings.removeFacetsSmallerThanNrOfPoints,
    removeFacetsFromLargeToSmall: settings.removeFacetsFromLargeToSmall,
    maximumNumberOfFacets: settings.maximumNumberOfFacets,
    nrOfTimesToHalveBorderSegments: settings.nrOfTimesToHalveBorderSegments,
    showLabels: input.showLabels,
    fillFacets: input.fillFacets,
    showBorders: input.showBorders,
    geometry: {
      mode: input.geometryMode,
      cellSize: input.geoCellSize,
      jitter: input.geoJitter,
      edgeStrength: input.geoEdgeStrength,
      useSourceColor: input.geoUseSourceColor,
    },
    artisticPreset: input.artisticPreset,
    artistic,
    svgSizeMultiplier: input.svgSizeMultiplier,
    svgFontSize: input.svgFontSize,
    svgFontColor: input.svgFontColor,
    svgCurveMode: input.svgCurveMode,
  };

  const elapsedMs = Math.round(performance.now() - startedAt);
  report(onProgress, { stage: 'completed', label: 'Browser processing completed', progress: 100 });

  return {
    svgString,
    svgBlob,
    previewBlob: preview.blob,
    previewContentType: preview.contentType,
    previewExt: preview.ext,
    colors,
    processOptions,
    width: imgData.width,
    height: imgData.height,
    elapsedMs,
  };
}
