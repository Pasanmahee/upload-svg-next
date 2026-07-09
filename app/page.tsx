'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type ProcessResponse = {
  message?: string;
  dbRecord?: any;
  recordId?: string | null;
  draftOnly?: boolean;
  draftId?: string | null;
  uploadSvgUrl?: string | null;
  publicUrlSvg?: string;
  publicUrlPng?: string;
  svgDataUrl?: string;
  previewDataUrl?: string;
  gcsUrlSvg?: string | null;
  gcsUrlPng?: string | null;
  previewContentType?: string;
  previewExt?: string;
  colors?: string[];
  processOptions?: any;
  error?: string;
  details?: string;
  stage?: string;
  code?: string;
};

type GeometryMode = 'facets' | 'triangles' | 'triangles_sym' | 'squares' | 'hex' | 'mixed';
type ArtisticPreset = 'classic' | 'stained_glass' | 'soft_ink' | 'poster_flat' | 'low_poly' | 'low_poly_sym';

type ProcessSettings = {
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

const defaultSettings: ProcessSettings = {
  kMeansNrOfClusters: 16,
  kMeansMinDeltaDifference: 1,
  kMeansClusteringColorSpace: 2,
  maximumNumberOfFacets: 200,
  removeFacetsSmallerThanNrOfPoints: 5,
  removeFacetsFromLargeToSmall: true,
  narrowPixelStripCleanupRuns: 3,
  nrOfTimesToHalveBorderSegments: 3,
  resizeImageIfTooLarge: true,
  resizeImageWidth: 1024,
  resizeImageHeight: 1024,
  speckleCleanupEnabled: true,
  speckleCleanupRadius: 1,
  speckleCleanupPasses: 1,

  showLabels: true,
  fillFacets: true,
  showBorders: true,
  geometryMode: 'facets',
  geoCellSize: 32,
  geoJitter: 0.35,
  geoEdgeStrength: 0.35,
  geoUseSourceColor: true,
  artisticPreset: 'classic',
  svgSizeMultiplier: 3,
  svgFontSize: 50,
  svgFontColor: '#000',
  svgCurveMode: 'cubic_catmull',
  borderSimplifyEpsilon: 1,
  strokeColorMode: 'ink',
  innerStrokeWidth: 0.5,
  outerStrokeWidth: 2,
  strokeOpacity: 0.85,
  nonScalingStroke: true,
  paintOrderStrokeFill: true,
  labelHalo: true,
  debug: true,
};

function boolValue(value: boolean) {
  return value ? 'true' : 'false';
}

function useObjectUrl(file: File | null) {
  return useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
}

function NumberInput({ label, value, onChange, min, max, step = 1, help }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}) {
  return (
    <label>
      {label}
      <div>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {help ? <div className="help">{help}</div> : null}
    </label>
  );
}

function CheckInput({ label, checked, onChange, help }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
}) {
  return (
    <label className="checkRow">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export default function Home() {
  const [userId, setUserId] = useState('demo@example.com');
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<ProcessSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);

  const previewUrl = useObjectUrl(file);

  function update<K extends keyof ProcessSettings>(key: K, value: ProcessSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(preset: ArtisticPreset) {
    setSettings((prev) => {
      const base = { ...prev, artisticPreset: preset };
      if (preset === 'classic') {
        return { ...base, geometryMode: 'facets', borderSimplifyEpsilon: 1, strokeColorMode: 'ink', innerStrokeWidth: 0.5, outerStrokeWidth: 2, strokeOpacity: 0.85, nonScalingStroke: true, paintOrderStrokeFill: true, labelHalo: true, fillFacets: true, showBorders: true, showLabels: true };
      }
      if (preset === 'stained_glass') {
        return { ...base, geometryMode: 'facets', borderSimplifyEpsilon: 0.8, strokeColorMode: 'ink', innerStrokeWidth: 1.4, outerStrokeWidth: 2.8, strokeOpacity: 0.95, nonScalingStroke: true, paintOrderStrokeFill: true, labelHalo: true, fillFacets: true, showBorders: true, showLabels: true };
      }
      if (preset === 'soft_ink') {
        return { ...base, geometryMode: 'facets', borderSimplifyEpsilon: 0.6, strokeColorMode: 'soft', innerStrokeWidth: 0.7, outerStrokeWidth: 1.4, strokeOpacity: 0.75, nonScalingStroke: true, paintOrderStrokeFill: true, labelHalo: true, fillFacets: true, showBorders: true, showLabels: true };
      }
      if (preset === 'poster_flat') {
        return { ...base, geometryMode: 'facets', borderSimplifyEpsilon: 1.6, strokeColorMode: 'ink', innerStrokeWidth: 0.4, outerStrokeWidth: 1.4, strokeOpacity: 0.8, nonScalingStroke: true, paintOrderStrokeFill: true, labelHalo: true, fillFacets: true, showBorders: true, showLabels: true, maximumNumberOfFacets: Math.min(prev.maximumNumberOfFacets, 180) };
      }
      if (preset === 'low_poly') {
        return { ...base, geometryMode: 'triangles', borderSimplifyEpsilon: 0.5, strokeColorMode: 'soft', innerStrokeWidth: 0.5, outerStrokeWidth: 1.2, strokeOpacity: 0.65, nonScalingStroke: true, paintOrderStrokeFill: true, labelHalo: false, showLabels: false };
      }
      return { ...base, geometryMode: 'triangles_sym', borderSimplifyEpsilon: 0.5, strokeColorMode: 'soft', innerStrokeWidth: 0.5, outerStrokeWidth: 1.2, strokeOpacity: 0.65, nonScalingStroke: true, paintOrderStrokeFill: true, labelHalo: false, showLabels: false };
    });
  }

  function appendSettings(fd: FormData) {
    fd.append('kMeansNrOfClusters', String(settings.kMeansNrOfClusters));
    fd.append('kMeansMinDeltaDifference', String(settings.kMeansMinDeltaDifference));
    fd.append('kMeansClusteringColorSpace', String(settings.kMeansClusteringColorSpace));
    fd.append('maximumNumberOfFacets', String(settings.maximumNumberOfFacets));
    fd.append('removeFacetsSmallerThanNrOfPoints', String(settings.removeFacetsSmallerThanNrOfPoints));
    fd.append('removeFacetsFromLargeToSmall', boolValue(settings.removeFacetsFromLargeToSmall));
    fd.append('narrowPixelStripCleanupRuns', String(settings.narrowPixelStripCleanupRuns));
    fd.append('nrOfTimesToHalveBorderSegments', String(settings.nrOfTimesToHalveBorderSegments));
    fd.append('resizeImageIfTooLarge', boolValue(settings.resizeImageIfTooLarge));
    fd.append('resizeImageWidth', String(settings.resizeImageWidth));
    fd.append('resizeImageHeight', String(settings.resizeImageHeight));
    fd.append('speckleCleanupEnabled', boolValue(settings.speckleCleanupEnabled));
    fd.append('speckleCleanupRadius', String(settings.speckleCleanupRadius));
    fd.append('speckleCleanupPasses', String(settings.speckleCleanupPasses));

    fd.append('showLabels', boolValue(settings.showLabels));
    fd.append('fillFacets', boolValue(settings.fillFacets));
    fd.append('showBorders', boolValue(settings.showBorders));
    fd.append('geometryMode', settings.geometryMode);
    fd.append('geoCellSize', String(settings.geoCellSize));
    fd.append('geoJitter', String(settings.geoJitter));
    fd.append('geoEdgeStrength', String(settings.geoEdgeStrength));
    fd.append('geoUseSourceColor', boolValue(settings.geoUseSourceColor));
    fd.append('artisticPreset', settings.artisticPreset);
    fd.append('svgSizeMultiplier', String(settings.svgSizeMultiplier));
    fd.append('svgFontSize', String(settings.svgFontSize));
    fd.append('svgFontColor', settings.svgFontColor);
    fd.append('svgCurveMode', settings.svgCurveMode);
    fd.append('borderSimplifyEpsilon', String(settings.borderSimplifyEpsilon));
    fd.append('strokeColorMode', settings.strokeColorMode);
    fd.append('innerStrokeWidth', String(settings.innerStrokeWidth));
    fd.append('outerStrokeWidth', String(settings.outerStrokeWidth));
    fd.append('strokeOpacity', String(settings.strokeOpacity));
    fd.append('nonScalingStroke', boolValue(settings.nonScalingStroke));
    fd.append('paintOrderStrokeFill', boolValue(settings.paintOrderStrokeFill));
    fd.append('labelHalo', boolValue(settings.labelHalo));
    fd.append('debug', boolValue(settings.debug));
  }

  async function onProcess() {
    if (!file) return;
    setIsLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      // Keep backend/admin generated SVGs as upload drafts first.
      // They should not appear in the mobile app's My Works until uploaded intentionally from /upload-svg.
      fd.append('draftOnly', 'true');
      appendSettings(fd);

      const res = await fetch(`/api/process-image/${encodeURIComponent(userId)}?debug=${settings.debug ? '1' : '0'}`, {
        method: 'POST',
        body: fd,
      });

      const text = await res.text();
      let json: ProcessResponse;
      try {
        json = text ? (JSON.parse(text) as ProcessResponse) : {};
      } catch {
        json = {
          error: `Backend returned a non-JSON response (${res.status} ${res.statusText || 'Error'}): ${text.slice(0, 500)}`,
        };
      }
      setResult(json);
    } catch (e: any) {
      setResult({ error: e?.message || 'Unexpected error' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main>
      <h1>Upload & Process Image</h1>
      <p>
        This page calls <code>/api/process-image/[userId]</code> to generate paint-by-number SVG output and a preview image.
      </p>
      <p>
        Also available: <Link href="/upload-svg">Upload SVG Data</Link> ·{' '}
        <Link href="/manage-images">Manage Uploaded Images</Link> ·{' '}
        <Link href="/game-settings">Game Settings</Link> ·{' '}
        <Link href="/pack-management">Pack Management</Link>.
      </p>

      <div className="card processCard">
        <div className="row">
          <label>
            User ID (email/UUID)
            <div>
              <input value={userId} onChange={(e) => setUserId(e.target.value)} type="text" placeholder="demo@example.com" />
            </div>
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <label>
            Upload image
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </label>
        </div>

        <section className="settingsPanel visibleSettingsPanel">
          <div className="settingsHeader">
            <div>
              <h2>SVG generation</h2>
              <p>These output controls match the uploaded SVG generator output tab and are always visible.</p>
            </div>
            <button className="secondary" type="button" onClick={() => setSettings(defaultSettings)} disabled={isLoading}>
              Reset settings
            </button>
          </div>

          <div className="generatorStatusRow" aria-label="SVG generation pipeline steps">
            {['Quantized image', 'Facet reduction', 'Border tracing', 'Border segmentation', 'Label placement', 'Output'].map((label, idx) => (
              <span key={label} className={idx === 5 ? 'generatorStep active' : 'generatorStep'}>{label}</span>
            ))}
          </div>

          <div className="svgRenderOptions">
            <strong>SVG render options</strong>
            <CheckInput label="Show labels" checked={settings.showLabels} onChange={(v) => update('showLabels', v)} />
            <CheckInput label="Fill facets" checked={settings.fillFacets} onChange={(v) => update('fillFacets', v)} />
            <CheckInput label="Show borders" checked={settings.showBorders} onChange={(v) => update('showBorders', v)} />
          </div>

          <div className="grid svgGenerationGrid">
            <label>
              Geometry mode
              <div>
                <select value={settings.geometryMode} onChange={(e) => update('geometryMode', e.target.value as GeometryMode)}>
                  <option value="facets">Facets (paint-by-number)</option>
                  <option value="triangles">Triangles (low poly)</option>
                  <option value="triangles_sym">Triangles (symmetry)</option>
                  <option value="squares">Squares grid</option>
                  <option value="hex">Hex mosaic</option>
                  <option value="mixed">Mixed (triangles + quads)</option>
                </select>
              </div>
              <div className="help">Backend currently processes Facets mode. Other modes are visible for generator parity.</div>
            </label>
            <NumberInput label="Shape size (px)" value={settings.geoCellSize} min={6} max={200} onChange={(v) => update('geoCellSize', v || 32)} />
            <NumberInput label="Jitter (0–1)" value={settings.geoJitter} min={0} max={1} step={0.05} onChange={(v) => update('geoJitter', v || 0)} />
            <NumberInput label="Edge detail (0–1)" value={settings.geoEdgeStrength} min={0} max={1} step={0.05} onChange={(v) => update('geoEdgeStrength', v || 0)} />
            <CheckInput label="Use original colors" checked={settings.geoUseSourceColor} onChange={(v) => update('geoUseSourceColor', v)} />

            <label>
              Artistic preset
              <div>
                <select value={settings.artisticPreset} onChange={(e) => applyPreset(e.target.value as ArtisticPreset)}>
                  <option value="classic">Classic</option>
                  <option value="stained_glass">Stained glass</option>
                  <option value="soft_ink">Soft ink</option>
                  <option value="poster_flat">Poster flat</option>
                  <option value="low_poly">Low poly</option>
                  <option value="low_poly_sym">Low poly (symmetry)</option>
                </select>
              </div>
            </label>
            <NumberInput label="Border simplify ε" value={settings.borderSimplifyEpsilon} min={0} max={10} step={0.1} onChange={(v) => update('borderSimplifyEpsilon', v || 0)} />
            <label>
              Stroke color
              <div>
                <select value={settings.strokeColorMode} onChange={(e) => update('strokeColorMode', e.target.value as ProcessSettings['strokeColorMode'])}>
                  <option value="ink">Ink (black)</option>
                  <option value="soft">Soft (darken fill)</option>
                </select>
              </div>
            </label>
            <NumberInput label="Inner stroke width (px)" value={settings.innerStrokeWidth} min={0} max={10} step={0.1} onChange={(v) => update('innerStrokeWidth', v || 0)} />
            <NumberInput label="Outer stroke width (px)" value={settings.outerStrokeWidth} min={0} max={20} step={0.1} onChange={(v) => update('outerStrokeWidth', v || 0)} />
            <NumberInput label="Stroke opacity" value={settings.strokeOpacity} min={0} max={1} step={0.05} onChange={(v) => update('strokeOpacity', v || 0)} />
            <CheckInput label="Non-scaling strokes" checked={settings.nonScalingStroke} onChange={(v) => update('nonScalingStroke', v)} />
            <CheckInput label="Stroke behind fill" checked={settings.paintOrderStrokeFill} onChange={(v) => update('paintOrderStrokeFill', v)} />
            <CheckInput label="Label halo" checked={settings.labelHalo} onChange={(v) => update('labelHalo', v)} />
            <NumberInput label="SVG size multiplier" value={settings.svgSizeMultiplier} min={1} max={8} onChange={(v) => update('svgSizeMultiplier', v || 1)} />
            <NumberInput label="Label font size" value={settings.svgFontSize} min={1} max={160} onChange={(v) => update('svgFontSize', v || 50)} />
            <label>
              Label font color
              <div>
                <input type="text" value={settings.svgFontColor} onChange={(e) => update('svgFontColor', e.target.value)} />
              </div>
            </label>
          </div>
        </section>

        <section className="settingsPanel">
          <div className="settingsHeader">
            <div>
              <h2>Processing settings</h2>
              <p>These controls affect clustering, facet cleanup, and label placement before SVG output.</p>
            </div>
          </div>

          <div className="grid">
            <NumberInput label="K / clusters" value={settings.kMeansNrOfClusters} min={2} max={64} onChange={(v) => update('kMeansNrOfClusters', v || 16)} help="Higher = more colors." />
            <NumberInput label="Max facets" value={settings.maximumNumberOfFacets} min={20} max={5000} onChange={(v) => update('maximumNumberOfFacets', v || 200)} help="Higher = more small areas." />
            <label>
              Color space
              <div>
                <select value={settings.kMeansClusteringColorSpace} onChange={(e) => update('kMeansClusteringColorSpace', Number(e.target.value))}>
                  <option value={0}>RGB</option>
                  <option value={1}>HSL</option>
                  <option value={2}>LAB recommended</option>
                </select>
              </div>
              <div className="help">LAB gives better visual grouping for photos.</div>
            </label>
          </div>

          <details className="advancedSettings">
            <summary>Advanced processing cleanup settings</summary>

            <div className="grid" style={{ marginTop: 14 }}>
              <NumberInput label="K-means min delta" value={settings.kMeansMinDeltaDifference} min={0.1} max={20} step={0.1} onChange={(v) => update('kMeansMinDeltaDifference', v || 1)} />
              <NumberInput label="Remove facets smaller than" value={settings.removeFacetsSmallerThanNrOfPoints} min={1} max={200} onChange={(v) => update('removeFacetsSmallerThanNrOfPoints', v || 5)} />
              <NumberInput label="Narrow strip cleanup runs" value={settings.narrowPixelStripCleanupRuns} min={0} max={10} onChange={(v) => update('narrowPixelStripCleanupRuns', v || 0)} />
              <NumberInput label="Border halve/smooth steps" value={settings.nrOfTimesToHalveBorderSegments} min={0} max={8} onChange={(v) => update('nrOfTimesToHalveBorderSegments', v || 0)} />
              <NumberInput label="Resize max width" value={settings.resizeImageWidth} min={64} max={3000} onChange={(v) => update('resizeImageWidth', v || 1024)} />
              <NumberInput label="Resize max height" value={settings.resizeImageHeight} min={64} max={3000} onChange={(v) => update('resizeImageHeight', v || 1024)} />
              <NumberInput label="Speckle radius" value={settings.speckleCleanupRadius} min={0} max={3} onChange={(v) => update('speckleCleanupRadius', v || 0)} />
              <NumberInput label="Speckle passes" value={settings.speckleCleanupPasses} min={0} max={5} onChange={(v) => update('speckleCleanupPasses', v || 0)} />
              <label>
                Curve mode
                <div>
                  <select value={settings.svgCurveMode} onChange={(e) => update('svgCurveMode', e.target.value as ProcessSettings['svgCurveMode'])}>
                    <option value="cubic_catmull">Smooth cubic Catmull</option>
                    <option value="quadratic_midpoint">Legacy quadratic</option>
                  </select>
                </div>
              </label>
            </div>

            <div className="checkGrid">
              <CheckInput label="Resize image if too large" checked={settings.resizeImageIfTooLarge} onChange={(v) => update('resizeImageIfTooLarge', v)} />
              <CheckInput label="Remove facets large-to-small" checked={settings.removeFacetsFromLargeToSmall} onChange={(v) => update('removeFacetsFromLargeToSmall', v)} />
              <CheckInput label="Speckle cleanup" checked={settings.speckleCleanupEnabled} onChange={(v) => update('speckleCleanupEnabled', v)} />
              <CheckInput label="Show debug errors" checked={settings.debug} onChange={(v) => update('debug', v)} />
            </div>
          </details>
        </section>

        {settings.geometryMode !== 'facets' ? (
          <div className="warningBox">
            Low-poly/grid geometry settings are visible because they exist in the uploaded generator. This backend build currently processes <strong>Facets</strong> mode only.
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={onProcess} disabled={!file || isLoading}>
            {isLoading ? 'Processing…' : 'Process'}
          </button>
          <button className="secondary" onClick={() => setResult(null)} disabled={isLoading}>
            Clear
          </button>
          <small>
            Tip: Start with smaller images and low facet count, then increase quality.
          </small>
        </div>
      </div>

      {previewUrl && (
        <div style={{ marginTop: 20 }}>
          <h3>Input preview</h3>
          <img className="preview" src={previewUrl} alt="preview" />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 20 }}>
          <h3>API response</h3>
          <pre className={result.error ? 'errorPre' : ''}>{JSON.stringify(result, null, 2)}</pre>

          {result.error && result.details ? (
            <p className="help"><strong>Error details:</strong> {result.details}</p>
          ) : null}

          {result.draftOnly && !result.error ? (
            <div className="draftReadyBox">
              <div>
                <strong>Ready for Upload SVG</strong>
                <p>This generated SVG was saved as a draft only. It was not added to My Works.</p>
              </div>
              {result.uploadSvgUrl ? (
                <Link className="buttonLink" href={result.uploadSvgUrl}>
                  Load into Upload SVG
                </Link>
              ) : (
                <span className="help">Draft link unavailable because MongoDB is not configured.</span>
              )}
            </div>
          ) : null}

          {result.previewDataUrl || result.publicUrlPng ? (
            <div className="processPreviewBox">
              <h4>Generated preview</h4>
              <img
                className="generatedPreview"
                src={result.previewDataUrl || result.publicUrlPng}
                alt="Generated process preview"
              />
              <div className="previewActions">
                <a
                  className="buttonLink secondaryButtonLink"
                  href={result.previewDataUrl || result.publicUrlPng}
                  download={`processed-preview.${result.previewExt || 'webp'}`}
                >
                  Download preview
                </a>
                {result.svgDataUrl || result.publicUrlSvg ? (
                  <a
                    className="buttonLink secondaryButtonLink"
                    href={result.svgDataUrl || result.publicUrlSvg}
                    download="processed-image.svg"
                  >
                    Download SVG
                  </a>
                ) : null}
              </div>
              {result.gcsUrlPng ? (
                <p className="help">Preview was also saved to GCS, but the admin page uses an inline preview so private bucket permissions do not block viewing.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
