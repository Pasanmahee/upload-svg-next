'use client';

import { useEffect, useMemo, useState } from 'react';

const PACK_TYPES = ['free', 'coins', 'premium', 'rewarded', 'streak', 'achievement', 'admin'] as const;
type PackType = (typeof PACK_TYPES)[number];
type Alert = { kind: 'success' | 'error' | 'info'; text: string } | null;

type PackRecord = {
  packId: string;
  title: string;
  description: string;
  coverImageUrl?: string | null;
  type: PackType;
  priceCoins: number;
  requiredStreak?: number | null;
  requiredAchievementId?: string | null;
  imageIds: string[];
  imageCount: number;
  manifestUrl?: string | null;
  manifestVersion: number;
  sizeBytes: number;
  sizeLabel?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ImageRecord = {
  _id: string;
  pngData?: string;
  levelId?: string | null;
  title?: string | null;
  name?: string | null;
  createdAt?: string | null;
  date?: string | null;
};

type GameLevel = {
  id: string;
  name: string;
  shortName: string;
  emoji: string;
};

type PackDraft = {
  packId: string;
  title: string;
  description: string;
  coverImageUrl: string;
  type: PackType;
  priceCoins: string;
  requiredStreak: string;
  requiredAchievementId: string;
  manifestUrl: string;
  manifestVersion: string;
  sizeBytes: string;
  sortOrder: string;
  isActive: boolean;
  imageIds: string[];
};

const emptyDraft: PackDraft = {
  packId: '',
  title: '',
  description: '',
  coverImageUrl: '',
  type: 'free',
  priceCoins: '0',
  requiredStreak: '',
  requiredAchievementId: '',
  manifestUrl: '',
  manifestVersion: '1',
  sizeBytes: '0',
  sortOrder: '100',
  isActive: true,
  imageIds: [],
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

function cleanPackId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function imageLabel(image: ImageRecord): string {
  return image.title || image.name || `Image ${image._id.slice(-6)}`;
}

function imageLevelLabel(image: ImageRecord, levels: GameLevel[]): string {
  const level = levels.find((item) => item.id === image.levelId);
  return level ? `${level.emoji || '🖼️'} ${level.name}` : 'Auto / unassigned';
}

function draftFromPack(pack: PackRecord): PackDraft {
  return {
    packId: pack.packId,
    title: pack.title || pack.packId,
    description: pack.description || '',
    coverImageUrl: pack.coverImageUrl || '',
    type: PACK_TYPES.includes(pack.type) ? pack.type : 'free',
    priceCoins: String(pack.priceCoins ?? 0),
    requiredStreak: pack.requiredStreak == null ? '' : String(pack.requiredStreak),
    requiredAchievementId: pack.requiredAchievementId || '',
    manifestUrl: pack.manifestUrl || '',
    manifestVersion: String(pack.manifestVersion || 1),
    sizeBytes: String(pack.sizeBytes || 0),
    sortOrder: String(pack.sortOrder || 100),
    isActive: pack.isActive !== false,
    imageIds: Array.isArray(pack.imageIds) ? pack.imageIds : [],
  };
}

function toNumber(value: string, fallback = 0): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

export default function PackManagementPage() {
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [levels, setLevels] = useState<GameLevel[]>([]);
  const [draft, setDraft] = useState<PackDraft>(emptyDraft);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState<string>('');
  const [alert, setAlert] = useState<Alert>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!alert) return;
    const timeoutMs = alert.kind === 'error' ? 6500 : 3500;
    const timer = window.setTimeout(() => setAlert(null), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [alert]);

  const selectedImageSet = useMemo(() => new Set(draft.imageIds), [draft.imageIds]);

  const filteredImages = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return images.filter((image) => {
      if (levelFilter !== 'all') {
        if (levelFilter === 'unassigned') {
          if (image.levelId) return false;
        } else if (image.levelId !== levelFilter) {
          return false;
        }
      }
      if (!query) return true;
      const haystack = `${image._id} ${image.title || ''} ${image.name || ''} ${image.levelId || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [images, levelFilter, searchText]);

  const selectedPack = useMemo(() => packs.find((pack) => pack.packId === selectedPackId) || null, [packs, selectedPackId]);
  const selectedLevelName = useMemo(() => levels.find((level) => level.id === levelFilter)?.name || '', [levels, levelFilter]);

  async function readJson(res: Response) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false || data?.ok === false || data?.error) {
      throw new Error(data?.error || data?.details || `Request failed (${res.status})`);
    }
    return data;
  }

  async function loadAll() {
    setLoading(true);
    setAlert(null);
    try {
      const [packsRes, imagesRes, configRes] = await Promise.all([
        fetch('/api/admin/packs', { cache: 'no-store' }),
        fetch('/api/images?scope=public&limit=48', { cache: 'no-store' }),
        fetch('/api/admin/game-config', { cache: 'no-store' }),
      ]);

      const packsJson = await readJson(packsRes);
      const imagesJson = await readJson(imagesRes);
      const configJson = await readJson(configRes);

      const loadedPacks = Array.isArray(packsJson.packs) ? packsJson.packs : [];
      setPacks(loadedPacks);
      setImages(Array.isArray(imagesJson.data) ? imagesJson.data : []);
      setLevels(Array.isArray(configJson?.config?.levels) ? configJson.config.levels : []);

      if (!selectedPackId && loadedPacks[0]) {
        setSelectedPackId(loadedPacks[0].packId);
        setDraft(draftFromPack(loadedPacks[0]));
      } else if (selectedPackId) {
        const refreshed = loadedPacks.find((pack: PackRecord) => pack.packId === selectedPackId);
        if (refreshed) setDraft(draftFromPack(refreshed));
      }
    } catch (err) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectPack(pack: PackRecord) {
    setSelectedPackId(pack.packId);
    setDraft(draftFromPack(pack));
    setAlert(null);
  }

  function startNewPack() {
    setSelectedPackId('');
    setDraft({ ...emptyDraft, sortOrder: String((packs.length + 1) * 10) });
    setAlert({ kind: 'info', text: 'Create a new pack, choose unlock type, then assign images.' });
  }

  function updateDraft<K extends keyof PackDraft>(key: K, value: PackDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleImage(imageId: string) {
    setDraft((current) => {
      const exists = current.imageIds.includes(imageId);
      return {
        ...current,
        imageIds: exists ? current.imageIds.filter((id) => id !== imageId) : [...current.imageIds, imageId],
      };
    });
  }

  function addFilteredImages() {
    const ids = filteredImages.map((image) => image._id).filter(Boolean);
    if (!ids.length) return;
    setDraft((current) => ({ ...current, imageIds: Array.from(new Set([...current.imageIds, ...ids])) }));
    setAlert({ kind: 'success', text: `Added ${ids.length} image(s) from current filter.` });
  }

  function removeFilteredImages() {
    const ids = new Set(filteredImages.map((image) => image._id));
    setDraft((current) => ({ ...current, imageIds: current.imageIds.filter((id) => !ids.has(id)) }));
    setAlert({ kind: 'info', text: 'Removed current filtered images from this pack.' });
  }

  function clearImages() {
    setDraft((current) => ({ ...current, imageIds: [] }));
    setAlert({ kind: 'info', text: 'Image selection cleared for this pack.' });
  }

  async function savePack() {
    const packId = cleanPackId(draft.packId || draft.title);
    if (!packId) {
      setAlert({ kind: 'error', text: 'Pack ID or title is required.' });
      return;
    }
    setSaving(true);
    setAlert(null);
    try {
      const body = {
        packId,
        title: draft.title.trim() || packId,
        description: draft.description.trim(),
        coverImageUrl: draft.coverImageUrl.trim() || null,
        type: draft.type,
        priceCoins: toNumber(draft.priceCoins, 0),
        requiredStreak: draft.requiredStreak.trim() ? toNumber(draft.requiredStreak, 0) : null,
        requiredAchievementId: draft.requiredAchievementId.trim() || null,
        imageIds: draft.imageIds,
        manifestUrl: draft.manifestUrl.trim() || null,
        manifestVersion: Date.now(),
        sizeBytes: toNumber(draft.sizeBytes, 0),
        sortOrder: toNumber(draft.sortOrder, 100),
        isActive: draft.isActive,
      };

      const isExisting = Boolean(selectedPackId);
      const res = await fetch(isExisting ? `/api/admin/packs/${encodeURIComponent(selectedPackId)}` : '/api/admin/packs', {
        method: isExisting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      const savedPack = data.pack as PackRecord;
      setSelectedPackId(savedPack.packId);
      setDraft(draftFromPack(savedPack));
      await loadAll();
      setAlert({ kind: 'success', text: 'Pack saved successfully.' });
    } catch (err) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function deactivatePack() {
    if (!selectedPackId) return;
    if (!window.confirm(`Disable pack "${selectedPackId}"? It will stop showing to users.`)) return;
    setSaving(true);
    setAlert(null);
    try {
      const res = await fetch(`/api/admin/packs/${encodeURIComponent(selectedPackId)}`, { method: 'DELETE' });
      await readJson(res);
      await loadAll();
      setAlert({ kind: 'success', text: 'Pack disabled.' });
    } catch (err) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  function selectedImagesForDraft() {
    const map = new Map(images.map((image) => [image._id, image]));
    return draft.imageIds.map((id) => map.get(id)).filter((image): image is ImageRecord => Boolean(image));
  }

  return (
    <main>
      {alert ? (
        <div className={`alert ${alert.kind}`} role="status">
          <span>{alert.text}</span>
          <button className="alertClose" type="button" aria-label="Dismiss" onClick={() => setAlert(null)}>×</button>
        </div>
      ) : null}

      <div className="pageHeader">
        <div>
          <h1>Pack Management</h1>
          <p className="help">Create downloadable packs, choose unlock rules, and assign coloring images by level.</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={loadAll} disabled={loading || saving}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button onClick={startNewPack} disabled={saving}>New Pack</button>
        </div>
      </div>

      <section className="packManagerShell">
        <aside className="packListPanel card">
          <div className="featureTitleRow">
            <div>
              <h2>Packs</h2>
              <p className="help">Select a pack to edit.</p>
            </div>
          </div>

          <div className="packList">
            {packs.map((pack) => (
              <button
                key={pack.packId}
                type="button"
                className={`packListItem${selectedPackId === pack.packId ? ' active' : ''}${pack.isActive === false ? ' inactive' : ''}`}
                onClick={() => selectPack(pack)}
              >
                <span className="packListTitle">{pack.title || pack.packId}</span>
                <span className="packListMeta">{pack.type} · {pack.imageCount || pack.imageIds?.length || 0} image(s)</span>
                <span className={`packStatus ${pack.isActive === false ? 'off' : 'on'}`}>{pack.isActive === false ? 'Disabled' : 'Active'}</span>
              </button>
            ))}
            {!packs.length ? <p className="help">No packs found yet.</p> : null}
          </div>
        </aside>

        <section className="packEditorPanel card">
          <div className="featureTitleRow">
            <div>
              <h2>{selectedPack ? 'Edit Pack' : 'Create Pack'}</h2>
              <p className="help">Pack ID is used by the app and must stay stable after release.</p>
            </div>
            <div className="row">
              {selectedPackId ? (
                <a className="downloadBtn" href={`/api/packs/${encodeURIComponent(selectedPackId)}/manifest`} target="_blank" rel="noreferrer">Open Manifest</a>
              ) : null}
              <button onClick={savePack} disabled={saving}>{saving ? 'Saving…' : 'Save Pack'}</button>
              {selectedPackId ? <button className="secondary" onClick={deactivatePack} disabled={saving}>Disable</button> : null}
            </div>
          </div>

          <div className="settingsGrid">
            <label>
              Pack ID
              <input
                type="text"
                value={draft.packId}
                onChange={(e) => updateDraft('packId', cleanPackId(e.currentTarget.value))}
                placeholder="flowers_pack_01"
                disabled={Boolean(selectedPackId)}
              />
            </label>
            <label>
              Title
              <input type="text" value={draft.title} onChange={(e) => updateDraft('title', e.currentTarget.value)} placeholder="Flowers Pack" />
            </label>
            <label>
              Unlock type
              <select value={draft.type} onChange={(e) => updateDraft('type', e.currentTarget.value as PackType)}>
                {PACK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>
              Sort order
              <input type="number" min={0} value={draft.sortOrder} onChange={(e) => updateDraft('sortOrder', e.currentTarget.value)} />
            </label>
          </div>

          <label className="blockLabel">
            Description
            <textarea value={draft.description} onChange={(e) => updateDraft('description', e.currentTarget.value)} placeholder="Short pack description shown to players" />
          </label>

          <div className="settingsGrid compact">
            <label>
              Price coins
              <input type="number" min={0} value={draft.priceCoins} onChange={(e) => updateDraft('priceCoins', e.currentTarget.value)} disabled={!['coins', 'premium'].includes(draft.type)} />
            </label>
            <label>
              Required streak days
              <input type="number" min={0} value={draft.requiredStreak} onChange={(e) => updateDraft('requiredStreak', e.currentTarget.value)} disabled={draft.type !== 'streak'} placeholder="7" />
            </label>
            <label>
              Required achievement ID
              <input type="text" value={draft.requiredAchievementId} onChange={(e) => updateDraft('requiredAchievementId', e.currentTarget.value)} disabled={draft.type !== 'achievement'} placeholder="flower_collection_completed" />
            </label>
            <label>
              Estimated size bytes
              <input type="number" min={0} value={draft.sizeBytes} onChange={(e) => updateDraft('sizeBytes', e.currentTarget.value)} />
            </label>
          </div>

          <div className="settingsGrid compact">
            <label>
              Cover image URL
              <input type="text" value={draft.coverImageUrl} onChange={(e) => updateDraft('coverImageUrl', e.currentTarget.value)} placeholder="Optional image URL" />
            </label>
            <label>
              External manifest URL
              <input type="text" value={draft.manifestUrl} onChange={(e) => updateDraft('manifestUrl', e.currentTarget.value)} placeholder="Optional; leave empty for generated API manifest" />
            </label>
            <label className="checkboxLabel">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => updateDraft('isActive', e.currentTarget.checked)} />
              Active / visible to users
            </label>
          </div>

          <section className="imagePickerSection">
            <div className="featureTitleRow">
              <div>
                <h3>Assign Images</h3>
                <p className="help">Selected images will be written into this pack’s <code>imageIds</code> and included in its manifest.</p>
              </div>
              <div className="chips">
                <span className="chip">Selected: <strong>{draft.imageIds.length}</strong></span>
                {levelFilter !== 'all' ? <span className="chip">Filter: <strong>{levelFilter === 'unassigned' ? 'Unassigned' : selectedLevelName}</strong></span> : null}
              </div>
            </div>

            <div className="settingsGrid compact">
              <label>
                Level filter
                <select value={levelFilter} onChange={(e) => setLevelFilter(e.currentTarget.value)}>
                  <option value="all">All levels</option>
                  <option value="unassigned">Unassigned / auto</option>
                  {levels.map((level) => <option key={level.id} value={level.id}>{level.emoji} {level.name}</option>)}
                </select>
              </label>
              <label>
                Search image
                <input type="text" value={searchText} onChange={(e) => setSearchText(e.currentTarget.value)} placeholder="Search title, ID, level" />
              </label>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="secondary" type="button" onClick={addFilteredImages} disabled={!filteredImages.length}>Add filtered images</button>
              <button className="secondary" type="button" onClick={removeFilteredImages} disabled={!filteredImages.length}>Remove filtered images</button>
              <button className="secondary" type="button" onClick={clearImages} disabled={!draft.imageIds.length}>Clear selected</button>
            </div>

            {selectedImagesForDraft().length ? (
              <details className="selectedImagesDetails" open>
                <summary>Selected images ({draft.imageIds.length})</summary>
                <div className="chips" style={{ marginTop: 10 }}>
                  {selectedImagesForDraft().slice(0, 40).map((image) => (
                    <span className="chip" key={image._id}>{imageLabel(image)} <button type="button" onClick={() => toggleImage(image._id)}>×</button></span>
                  ))}
                  {draft.imageIds.length > 40 ? <span className="chip">+{draft.imageIds.length - 40} more</span> : null}
                </div>
              </details>
            ) : null}

            <div className="packImageGrid">
              {filteredImages.map((image) => {
                const checked = selectedImageSet.has(image._id);
                return (
                  <button
                    key={image._id}
                    type="button"
                    className={`packImageCard${checked ? ' selected' : ''}`}
                    onClick={() => toggleImage(image._id)}
                  >
                    <span className="packImageCheck">{checked ? '✓' : '+'}</span>
                    {image.pngData ? <img src={image.pngData} alt={imageLabel(image)} /> : <span className="emptyPreview">No preview</span>}
                    <strong>{imageLabel(image)}</strong>
                    <small>{imageLevelLabel(image, levels)}</small>
                    <small>{image._id}</small>
                  </button>
                );
              })}
              {!filteredImages.length ? <p className="help">No images match this filter.</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
