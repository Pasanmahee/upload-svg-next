'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

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

  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
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

  const svgPreviewUrl = useObjectUrl(svgFile);
  const imagePreviewUrl = useObjectUrl(imageFile);

  const { colors, invalid } = useMemo(() => parseColors(colorsText), [colorsText]);

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

  useEffect(() => {
    fetchCategories();
    fetchGameSettings();
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

      if (uploadImage && imageFile) {
        fd.append('imageFile', imageFile);
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
                  setUploadImage(e.currentTarget.checked);
                  if (!e.currentTarget.checked) setImageFile(null);
                }}
              />
              Attach image file (JPG/PNG/WebP) (optional)
            </label>
            <div className="help">If enabled, the client will send an image alongside the SVG.</div>
          </div>

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
        <div style={{ marginTop: 16 }} className={`alert ${alert.kind}`}>
          {alert.text}
        </div>
      )}
    </main>
  );
}
