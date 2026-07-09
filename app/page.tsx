'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type ProcessResponse = {
  message?: string;
  dbRecord?: any;
  recordId?: string | null;
  publicUrlSvg?: string;
  publicUrlPng?: string;
  previewContentType?: string;
  previewExt?: string;
  colors?: string[];
  processOptions?: any;
  error?: string;
  details?: string;
  stage?: string;
  code?: string;
};

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
  svgSizeMultiplier: 1,
  svgFontSize: 60,
  svgFontColor: '#333333',
  svgCurveMode: 'cubic_catmull',
  borderSimplifyEpsilon: 0,
  strokeColorMode: 'ink',
  innerStrokeWidth: 1,
  outerStrokeWidth: 1,
  strokeOpacity: 1,
  nonScalingStroke: false,
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
        This page calls <code>/api/process-image/[userId]</code> to generate paint-by-number SVG output and a preview image. It uses your admin session if you are logged in.
      </p>
      <p>
        Also available: <Link href="/upload-svg">Upload SVG Data</Link> (categories, colors, simplified flag) ·{' '}
        <Link href="/manage-images">Manage Uploaded Images</Link> (view/edit/replace/delete) ·{' '}
        <Link href="/game-settings">Game Settings</Link> (daily puzzle, rewards, levels) ·{' '}
        <Link href="/pack-management">Pack Management</Link> (create packs, assign images, unlock rules).
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

        <section className="settingsPanel">
          <div className="settingsHeader">
            <div>
              <h2>Processing settings</h2>
              <p>These controls are sent directly to <code>/api/process-image</code>.</p>
            </div>
            <button className="secondary" type="button" onClick={() => setSettings(defaultSettings)} disabled={isLoading}>
              Reset settings
            </button>
          </div>

          <div className="grid">
            <NumberInput label="K / clusters" value={settings.kMeansNrOfClusters} min={2} max={64} onChange={(v) => update('kMeansNrOfClusters', v || 16)} help="Higher = more colors." />
            <NumberInput label="Max facets" value={settings.maximumNumberOfFacets} min={20} max={5000} onChange={(v) => update('maximumNumberOfFacets', v || 200)} help="Higher = more small areas." />
            <NumberInput label="SVG size multiplier" value={settings.svgSizeMultiplier} min={1} max={8} onChange={(v) => update('svgSizeMultiplier', v || 1)} />
          </div>

          <details className="advancedSettings" open>
            <summary>Advanced settings</summary>

            <div className="grid" style={{ marginTop: 14 }}>
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
              <NumberInput label="K-means min delta" value={settings.kMeansMinDeltaDifference} min={0.1} max={20} step={0.1} onChange={(v) => update('kMeansMinDeltaDifference', v || 1)} />
              <NumberInput label="Remove facets smaller than" value={settings.removeFacetsSmallerThanNrOfPoints} min={1} max={200} onChange={(v) => update('removeFacetsSmallerThanNrOfPoints', v || 5)} />
              <NumberInput label="Narrow strip cleanup runs" value={settings.narrowPixelStripCleanupRuns} min={0} max={10} onChange={(v) => update('narrowPixelStripCleanupRuns', v || 0)} />
              <NumberInput label="Border halve/smooth steps" value={settings.nrOfTimesToHalveBorderSegments} min={0} max={8} onChange={(v) => update('nrOfTimesToHalveBorderSegments', v || 0)} />
              <NumberInput label="Resize max width" value={settings.resizeImageWidth} min={64} max={3000} onChange={(v) => update('resizeImageWidth', v || 1024)} />
              <NumberInput label="Resize max height" value={settings.resizeImageHeight} min={64} max={3000} onChange={(v) => update('resizeImageHeight', v || 1024)} />
              <NumberInput label="Speckle radius" value={settings.speckleCleanupRadius} min={0} max={3} onChange={(v) => update('speckleCleanupRadius', v || 0)} />
              <NumberInput label="Speckle passes" value={settings.speckleCleanupPasses} min={0} max={5} onChange={(v) => update('speckleCleanupPasses', v || 0)} />
              <NumberInput label="Font size" value={settings.svgFontSize} min={10} max={160} onChange={(v) => update('svgFontSize', v || 60)} />
              <label>
                Font color
                <div>
                  <input type="text" value={settings.svgFontColor} onChange={(e) => update('svgFontColor', e.target.value)} />
                </div>
              </label>
              <label>
                Curve mode
                <div>
                  <select value={settings.svgCurveMode} onChange={(e) => update('svgCurveMode', e.target.value as ProcessSettings['svgCurveMode'])}>
                    <option value="cubic_catmull">Smooth cubic Catmull</option>
                    <option value="quadratic_midpoint">Legacy quadratic</option>
                  </select>
                </div>
              </label>
              <label>
                Stroke mode
                <div>
                  <select value={settings.strokeColorMode} onChange={(e) => update('strokeColorMode', e.target.value as ProcessSettings['strokeColorMode'])}>
                    <option value="ink">Black ink</option>
                    <option value="soft">Soft darker fill color</option>
                  </select>
                </div>
              </label>
              <NumberInput label="Inner stroke width" value={settings.innerStrokeWidth} min={0.1} max={8} step={0.1} onChange={(v) => update('innerStrokeWidth', v || 1)} />
              <NumberInput label="Outer stroke width" value={settings.outerStrokeWidth} min={0.1} max={10} step={0.1} onChange={(v) => update('outerStrokeWidth', v || 1)} />
              <NumberInput label="Stroke opacity" value={settings.strokeOpacity} min={0.1} max={1} step={0.05} onChange={(v) => update('strokeOpacity', v || 1)} />
              <NumberInput label="Border simplify epsilon" value={settings.borderSimplifyEpsilon} min={0} max={5} step={0.1} onChange={(v) => update('borderSimplifyEpsilon', v || 0)} />
            </div>

            <div className="checkGrid">
              <CheckInput label="Resize image if too large" checked={settings.resizeImageIfTooLarge} onChange={(v) => update('resizeImageIfTooLarge', v)} />
              <CheckInput label="Remove facets large-to-small" checked={settings.removeFacetsFromLargeToSmall} onChange={(v) => update('removeFacetsFromLargeToSmall', v)} />
              <CheckInput label="Speckle cleanup" checked={settings.speckleCleanupEnabled} onChange={(v) => update('speckleCleanupEnabled', v)} />
              <CheckInput label="Label halo" checked={settings.labelHalo} onChange={(v) => update('labelHalo', v)} />
              <CheckInput label="Non-scaling stroke" checked={settings.nonScalingStroke} onChange={(v) => update('nonScalingStroke', v)} />
              <CheckInput label="Paint order stroke/fill" checked={settings.paintOrderStrokeFill} onChange={(v) => update('paintOrderStrokeFill', v)} />
              <CheckInput label="Show debug errors" checked={settings.debug} onChange={(v) => update('debug', v)} />
            </div>
          </details>
        </section>

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

          {result.publicUrlSvg && (
            <p>
              SVG: <a href={result.publicUrlSvg} target="_blank" rel="noreferrer">open</a>
            </p>
          )}
          {result.publicUrlPng && (
            <p>
              Preview: <a href={result.publicUrlPng} target="_blank" rel="noreferrer">open</a>
            </p>
          )}
        </div>
      )}
    </main>
  );
}
