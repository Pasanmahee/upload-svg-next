'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildOutlinePreviewSvg, choosePreviewStrokeColor } from '@/lib/svgPreview';

type Category = {
  _id: string;
  name: string;
};

type GameLevel = {
  id: string;
  name: string;
  emoji: string;
};

type Alert =
  | { kind: 'success' | 'error' | 'info'; text: string }
  | null;

type ProcessDraftPayload = {
  draftId: string;
  originalFileName?: string;
  svgFileName?: string;
  previewFileName?: string;
  svgDataUrl?: string | null;
  previewDataUrl?: string | null;
  previewContentType?: string;
  colors?: string[];
  error?: string;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return url;
}

async function dataUrlToFile(dataUrl: string, fileName: string, fallbackType: string) {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to read generated file: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], fileName, { type: blob.type || fallbackType });
}

/**
 * Create the library/card preview from the selected SVG in the browser.
 *
 * The optional image checkbox now means "use a separate custom image".
 * When it is off, a preview is still always generated from the SVG, matching
 * the original upload behaviour and avoiding an empty image card.
 */
async function svgFileToPreviewFile(
  svgFile: File,
  strokeColor = '#000000',
  maxDimension = 1024,
): Promise<File> {
  const sourceSvg = await svgFile.text();
  const outlineSvg = buildOutlinePreviewSvg(sourceSvg, strokeColor);
  const objectUrl = URL.createObjectURL(new Blob([outlineSvg], { type: 'image/svg+xml' }));

  try {
    const image = new Image();
    image.decoding = 'async';

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The selected SVG could not be rendered as a preview image.'));
      image.src = objectUrl;
    });

    const sourceWidth = Math.max(1, image.naturalWidth || image.width || 1024);
    const sourceHeight = Math.max(1, image.naturalHeight || image.height || 1024);
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas preview generation is not available in this browser.');

    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const webpBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    const blob = webpBlob ?? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not create a preview image from the SVG.');

    const baseName = (svgFile.name || 'uploaded-image.svg').replace(/\.svg$/i, '') || 'uploaded-image';
    const extension = blob.type === 'image/webp' ? 'webp' : 'png';
    return new File([blob], `${baseName}-preview.${extension}`, { type: blob.type });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function parseColors(input: string): { colors: string[]; invalid: string[] } {
  const raw = input
    .split(/[\n,]/g)
    .map((c) => c.trim())
    .filter(Boolean);

  const isHex = (s: string) => /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s);

  const colors: string[] = [];
  const invalid: string[] = [];

  for (const c of raw) {
    if (isHex(c)) colors.push(c.toUpperCase());
    else invalid.push(c);
  }

  // de-dupe
  const uniq = Array.from(new Set(colors));
  return { colors: uniq, invalid };
}

export default function UploadSvgPage() {
  const formRef = useRef<HTMLFormElement>(null);

  const [userId, setUserId] = useState('anonymous');
  const [isLoadingProcessDraft, setIsLoadingProcessDraft] = useState(false);

  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [autoPreviewFile, setAutoPreviewFile] = useState<File | null>(null);
  const [uploadImage, setUploadImage] = useState(false);

  const [colorsText, setColorsText] = useState('');
  const [hasSimplifiedSvg, setHasSimplifiedSvg] = useState(false);
  const [levels, setLevels] = useState<GameLevel[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);

  useEffect(() => {
    if (!alert) return;

    const timeoutMs = alert.kind === 'error' ? 6500 : 3500;
    const timer = window.setTimeout(() => setAlert(null), timeoutMs);

    return () => window.clearTimeout(timer);
  }, [alert]);

  const svgPreviewUrl = useObjectUrl(svgFile);
  const imagePreviewUrl = useObjectUrl(imageFile);
  const autoPreviewUrl = useObjectUrl(autoPreviewFile);

  const { colors, invalid } = useMemo(() => parseColors(colorsText), [colorsText]);
  const autoPreviewStroke = useMemo(() => choosePreviewStrokeColor(colors), [colors]);

  useEffect(() => {
    let cancelled = false;
    setAutoPreviewFile(null);

    if (!svgFile || uploadImage) return () => { cancelled = true; };

    svgFileToPreviewFile(svgFile, autoPreviewStroke)
      .then((preview) => {
        if (!cancelled) setAutoPreviewFile(preview);
      })
      .catch((error) => {
        // Upload remains available because /api/svgdata has the same fallback.
        console.warn('Could not render the automatic SVG preview in this browser.', error);
      });

    return () => { cancelled = true; };
  }, [svgFile, uploadImage, autoPreviewStroke]);

  const filteredCategories = useMemo(() => {
    const q = categoryFilter.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categoryFilter]);

  const selectedCategories = useMemo(() => {
    const map = new Map(categories.map((c) => [c._id, c] as const));
    return selectedCategoryIds.map((id) => map.get(id)).filter(Boolean) as Category[];
  }, [categories, selectedCategoryIds]);

  async function fetchGameSettings() {
    try {
      const res = await fetch('/api/admin/game-config', { method: 'GET' });
      const json = (await res.json()) as { config?: { levels?: GameLevel[] }; error?: string };
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch game settings');
      setLevels(Array.isArray(json.config?.levels) ? json.config!.levels! : []);
    } catch {
      setLevels([]);
    }
  }

  async function fetchCategories() {
    setIsFetchingCategories(true);
    try {
      const res = await fetch('/api/categories', { method: 'GET' });
      const json = (await res.json()) as { categories?: Category[]; error?: string };
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch categories');
      setCategories(Array.isArray(json.categories) ? json.categories : []);
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: `Error fetching categories: ${getErrorMessage(err)}` });
    } finally {
      setIsFetchingCategories(false);
    }
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;

    try {
      setAlert(null);
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as { category?: Category; created?: boolean; error?: string };
      if (!res.ok) throw new Error(json?.error || 'Failed to create category');

      const createdName = json.category?.name || name;
      setAlert({
        kind: 'success',
        text: json.created ? `Category created: ${createdName}` : `Category already exists: ${createdName}`,
      });

      setNewCategoryName('');
      await fetchCategories();

      if (json.category?._id) {
        setSelectedCategoryIds((prev) => (prev.includes(json.category!._id) ? prev : [...prev, json.category!._id]));
      }
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: `Error creating category: ${getErrorMessage(err)}` });
    }
  }

  async function loadProcessDraft(draftId: string) {
    setIsLoadingProcessDraft(true);
    try {
      setAlert({ kind: 'info', text: 'Loading generated SVG draft…' });
      const res = await fetch(`/api/process-drafts/${encodeURIComponent(draftId)}`, { method: 'GET' });
      const draft = (await res.json()) as ProcessDraftPayload;
      if (!res.ok) throw new Error(draft?.error || 'Failed to load generated SVG draft');

      if (!draft.svgDataUrl) throw new Error('Generated SVG draft does not contain SVG data.');

      const svg = await dataUrlToFile(draft.svgDataUrl, draft.svgFileName || 'processed-image.svg', 'image/svg+xml');
      setSvgFile(svg);

      if (Array.isArray(draft.colors) && draft.colors.length > 0) {
        setColorsText(draft.colors.join(', '));
      }

      if (draft.previewDataUrl) {
        const preview = await dataUrlToFile(
          draft.previewDataUrl,
          draft.previewFileName || 'processed-preview.webp',
          draft.previewContentType || 'image/webp',
        );
        setImageFile(preview);
        setUploadImage(true);
      }

      setAlert({
        kind: 'success',
        text: 'Generated SVG loaded. Select level/categories, then click Upload to add it to the app.',
      });
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: `Error loading generated SVG: ${getErrorMessage(err)}` });
    } finally {
      setIsLoadingProcessDraft(false);
    }
  }

  useEffect(() => {
    fetchCategories();
    fetchGameSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const draftId = new URLSearchParams(window.location.search).get('draftId');
    if (draftId) {
      loadProcessDraft(draftId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function hardResetFormUI() {
    // Clears actual <input type="file"> UI values too
    formRef.current?.reset();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAlert(null);

    // ✅ Snapshot the form element immediately (safe after await)
    const formEl = e.currentTarget;

    if (!svgFile) {
      setAlert({ kind: 'error', text: 'Please select an SVG file to upload.' });
      return;
    }

    if (invalid.length > 0) {
      setAlert({ kind: 'error', text: `Fix invalid color values: ${invalid.join(', ')}` });
      return;
    }

    if (colors.length === 0) {
      setAlert({ kind: 'error', text: 'Please provide at least one hex color (e.g., #000000).' });
      return;
    }

    if (colors.length > 256) {
      setAlert({ kind: 'error', text: 'Too many colors. Please keep it under 256.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('file', svgFile);
      fd.append('userId', userId.trim() || 'anonymous');
      fd.append('colors', JSON.stringify(colors));
      fd.append('categories', JSON.stringify(selectedCategoryIds));
      fd.append('newCategory', ''); // creation is handled by "Add"
      fd.append('hasSimplifiedSvg', String(hasSimplifiedSvg));
      fd.append('levelId', selectedLevelId);

      // A preview image must always be stored for the image library/game cards.
      // Checked: use the separately selected JPG/PNG/WebP file.
      // Unchecked: automatically rasterise the SVG in this browser.
      let previewFile: File | null = uploadImage && imageFile ? imageFile : null;
      if (!uploadImage) {
        try {
          previewFile = await svgFileToPreviewFile(svgFile, autoPreviewStroke);
        } catch (previewError) {
          // The server route also has an SVG-to-WebP fallback, so do not block
          // an otherwise valid upload on an unusual browser SVG renderer issue.
          console.warn('Browser SVG preview generation failed; using server fallback.', previewError);
        }
      }

      if (previewFile) {
        fd.append('imageFile', previewFile);
      }

      const res = await fetch('/api/svgdata', { method: 'POST', body: fd });
      const json = (await res.json()) as { message?: string; error?: string };

      if (!res.ok) {
        throw new Error(json?.error || json?.message || 'Upload failed');
      }

      setAlert({ kind: 'success', text: json?.message || 'SVG data uploaded successfully!' });

      // Reset state
      setSvgFile(null);
      setImageFile(null);
      setColorsText('');
      setSelectedCategoryIds([]);
      setHasSimplifiedSvg(false);
      setSelectedLevelId('');
      setUploadImage(false);

      // ✅ Reset the form using the captured element (NOT e.currentTarget)
      formEl.reset();

      await fetchCategories();
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: `Error: ${getErrorMessage(err)}` });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Upload SVG Data</h1>
      <p style={{ marginTop: -8 }}>
        <Link href="/">← Back to image processing</Link> · <Link href="/manage-images">Manage Uploaded Images</Link>
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <form ref={formRef} onSubmit={onSubmit}>
          {isLoadingProcessDraft && (
            <div className="alert info" style={{ marginBottom: 16 }}>
              Loading generated SVG from Process Image…
            </div>
          )}

          <div className="row">
            <label style={{ width: '100%' }}>
              User ID
              <div>
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.currentTarget.value)}
                  placeholder="anonymous"
                />
              </div>
              <div className="help">Any identifier (email/UUID). No auth is enforced.</div>
            </label>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />

          <h3 className="sectionTitle">Files</h3>
          <div className="row">
            <label style={{ width: '100%' }}>
              SVG file <span style={{ color: '#ef4444' }}>*</span>
              <div>
                <input
                  type="file"
                  accept=".svg,image/svg+xml"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const f = e.currentTarget.files?.[0] ?? null;
                    setSvgFile(f);
                    setAlert(null);
                  }}
                />
              </div>
              <div className="help">Upload the final paint-by-number SVG.</div>
            </label>
          </div>

          {svgPreviewUrl && (
            <div style={{ marginTop: 12 }}>
              <div className="help">SVG preview</div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: 'white' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={svgPreviewUrl} alt="SVG preview" style={{ maxWidth: '100%', height: 'auto' }} />
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={uploadImage}
                onChange={(e) => {
                  // Keep the selected file in memory when temporarily unchecked,
                  // so checking the option again does not require re-selecting it.
                  setUploadImage(e.currentTarget.checked);
                }}
              />
              Attach a separate image file (JPG/PNG/WebP) (optional)
            </label>
            <div className="help">
              Unchecked: a white, high-contrast outline preview is created automatically from the SVG. Checked: the selected image is used instead.
            </div>
          </div>

          {!uploadImage && autoPreviewUrl && (
            <div style={{ marginTop: 12 }}>
              <div className="help">Automatically generated outline preview</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="preview" src={autoPreviewUrl} alt="Automatically generated SVG outline preview" />
            </div>
          )}

          {uploadImage && (
            <div style={{ marginTop: 10 }}>
              <label style={{ width: '100%' }}>
                Image file
                <div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const f = e.currentTarget.files?.[0] ?? null;
                      setImageFile(f);
                    }}
                  />
                </div>
              </label>
              {imagePreviewUrl && (
                <div style={{ marginTop: 12 }}>
                  <div className="help">Image preview</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="preview" src={imagePreviewUrl} alt="image preview" />
                </div>
              )}
            </div>
          )}

          <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />

          <h3 className="sectionTitle">Colors</h3>
          <label style={{ width: '100%' }}>
            Hex colors (comma or newline separated) <span style={{ color: '#ef4444' }}>*</span>
            <div>
              <textarea
                value={colorsText}
                onChange={(e) => setColorsText(e.currentTarget.value)}
                placeholder="#000000, #FFFFFF"
              />
            </div>
            <div className="help">
              Valid: <b>{colors.length}</b> | Invalid: <b>{invalid.length}</b>
            </div>
          </label>

          {colors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="help">Preview</div>
              <div className="chips">
                {colors.slice(0, 40).map((c) => (
                  <span key={c} className="chip" title={c}>
                    <span
                      aria-hidden
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background: c,
                        border: '1px solid #e5e7eb',
                        display: 'inline-block',
                      }}
                    />
                    {c}
                  </span>
                ))}
                {colors.length > 40 && <span className="chip">+{colors.length - 40} more</span>}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={hasSimplifiedSvg}
                onChange={(e) => setHasSimplifiedSvg(e.currentTarget.checked)}
              />
              Has simplified SVG
            </label>
            <div className="help">Enable if the SVG is the simplified output (e.g., fewer paths / reduced detail).</div>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />

          <h3 className="sectionTitle">Level System</h3>
          <label style={{ width: '100%' }}>
            Assign to level
            <div>
              <select value={selectedLevelId} onChange={(e) => setSelectedLevelId(e.currentTarget.value)} style={{ width: '100%', minWidth: 0 }}>
                <option value="">Auto by keywords/categories</option>
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>{level.emoji} {level.name}</option>
                ))}
              </select>
            </div>
            <div className="help">You can also change this later from Game Settings.</div>
          </label>

          <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />

          <h3 className="sectionTitle">Categories</h3>
          <div className="row">
            <label style={{ width: '100%' }}>
              Search
              <div>
                <input
                  type="text"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.currentTarget.value)}
                  placeholder="Type to filter categories"
                />
              </div>
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="help">Select categories (multi-select)</div>
            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 12,
                background: 'white',
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {isFetchingCategories ? (
                <div className="help">Loading categories…</div>
              ) : filteredCategories.length === 0 ? (
                <div className="help">No categories found.</div>
              ) : (
                filteredCategories.map((c) => (
                  <label key={c._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <input
                      type="checkbox"
                      checked={selectedCategoryIds.includes(c._id)}
                      onChange={() => toggleCategory(c._id)}
                    />
                    {c.name}
                  </label>
                ))
              )}
            </div>
          </div>

          {selectedCategories.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="help">Selected</div>
              <div className="chips">
                {selectedCategories.map((c) => (
                  <span key={c._id} className="chip">
                    {c.name}
                    <button type="button" aria-label={`Remove ${c.name}`} onClick={() => toggleCategory(c._id)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="grid">
              <label>
                Add new category
                <div>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.currentTarget.value)}
                    placeholder="e.g., Animals"
                  />
                </div>
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={addCategory}
                  disabled={!newCategoryName.trim() || isFetchingCategories || isSubmitting}
                >
                  Add
                </button>
              </div>
            </div>
            <div className="help">Adds a category to MongoDB and auto-selects it.</div>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />

          <div className="row">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Uploading…' : 'Upload'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAlert(null);
                setSvgFile(null);
                setImageFile(null);
                setUploadImage(false);
                setColorsText('');
                setSelectedCategoryIds([]);
                setNewCategoryName('');
                setHasSimplifiedSvg(false);
                setSelectedLevelId('');

                // ✅ also clears the native file inputs
                hardResetFormUI();
              }}
              disabled={isSubmitting}
            >
              Reset
            </button>
            <small>Tip: keep SVG size reasonable; huge SVGs can increase upload time.</small>
          </div>
        </form>
      </div>

      {alert && (
        <div
          style={{ marginTop: 16 }}
          className={`alert ${alert.kind}`}
          role="status"
          aria-live="polite"
        >
          <span>{alert.text}</span>
          <button
            className="alertClose"
            type="button"
            aria-label="Close message"
            onClick={() => setAlert(null)}
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
