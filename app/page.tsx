'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type ProcessResponse = {
  message?: string;
  dbRecord?: any;
  publicUrlSvg?: string;
  publicUrlPng?: string;
  colors?: string[];
  error?: string;
};

export default function Home() {
  const [userId, setUserId] = useState('demo@example.com');
  const [file, setFile] = useState<File | null>(null);
  const [k, setK] = useState(16);
  const [maxFacets, setMaxFacets] = useState(200);
  const [sizeMultiplier, setSizeMultiplier] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  async function onProcess() {
    if (!file) return;
    setIsLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('kMeansNrOfClusters', String(k));
      fd.append('maximumNumberOfFacets', String(maxFacets));
      fd.append('svgSizeMultiplier', String(sizeMultiplier));

      const res = await fetch(`/api/process-image/${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: fd,
      });
      const json = (await res.json()) as ProcessResponse;
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
        This page calls <code>/api/process-image/[userId]</code> (no auth) to generate an SVG paint-by-number + a PNG preview.
      </p>
      <p>
        Also available: <Link href="/upload-svg">Upload SVG Data</Link> (categories, colors, simplified flag).
      </p>

      <div className="card">
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

        <div className="row" style={{ marginTop: 12 }}>
          <label>
            K (clusters)
            <div>
              <input type="text" value={k} onChange={(e) => setK(Number(e.target.value) || 16)} />
            </div>
          </label>
          <label>
            Max facets
            <div>
              <input type="text" value={maxFacets} onChange={(e) => setMaxFacets(Number(e.target.value) || 200)} />
            </div>
          </label>
          <label>
            SVG size multiplier
            <div>
              <input type="text" value={sizeMultiplier} onChange={(e) => setSizeMultiplier(Number(e.target.value) || 1)} />
            </div>
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={onProcess} disabled={!file || isLoading}>
            {isLoading ? 'Processing…' : 'Process'}
          </button>
          <button className="secondary" onClick={() => setResult(null)} disabled={isLoading}>
            Clear
          </button>
          <small>
            Tip: Start with smaller images (e.g., 1200px max) to keep the processing time manageable.
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
          <pre>{JSON.stringify(result, null, 2)}</pre>

          {result.publicUrlSvg && (
            <p>
              SVG: <a href={result.publicUrlSvg} target="_blank" rel="noreferrer">open</a>
            </p>
          )}
          {result.publicUrlPng && (
            <p>
              PNG: <a href={result.publicUrlPng} target="_blank" rel="noreferrer">open</a>
            </p>
          )}
        </div>
      )}
    </main>
  );
}
