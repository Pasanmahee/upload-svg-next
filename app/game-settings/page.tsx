'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

type GameLevel = {
  id: string;
  name: string;
  shortName: string;
  emoji: string;
  iconImageUrl?: string | null;
  description: string;
  requiredToUnlockNext: number;
  keywords: string[];
};

type DailyRewardConfig = {
  rewardCoins: number;
  streakRewardDays: number;
  specialPackId: string;
  specialPackName: string;
  iconImageUrl?: string | null;
  specialPackImageUrl?: string | null;
  manualImageByDate: Record<string, string>;
};

type GameConfig = {
  dailyReward: DailyRewardConfig;
  levels: GameLevel[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type ImageRecord = {
  _id: string;
  pngData?: string;
  levelId?: string | null;
  title?: string | null;
  name?: string | null;
  createdAt?: string;
  date?: string;
};

type AssetUploadResponse = {
  ok: boolean;
  asset?: {
    id: string;
    url: string;
    contentType: string;
    sizeBytes: number;
    width: number;
    height: number;
  };
  error?: string;
  details?: string;
};

type Alert = { kind: 'success' | 'error' | 'info'; text: string } | null;

const todayKey = () => new Date().toISOString().slice(0, 10);

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function imageLabel(image: ImageRecord): string {
  return image.title || image.name || `Image ${image._id.slice(-6)}`;
}

function keywordsToText(level: GameLevel) {
  return Array.isArray(level.keywords) ? level.keywords.join(', ') : '';
}

function textToKeywords(value: string): string[] {
  return Array.from(new Set(value.split(/[,\n]/g).map((x) => x.trim().toLowerCase()).filter(Boolean))).slice(0, 40);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

function assetLabel(url?: string | null): string {
  if (!url) return 'No image uploaded';
  const id = url.split('/').filter(Boolean).pop() || 'asset';
  return id.length > 18 ? `${id.slice(0, 18)}…` : id;
}

export default function GameSettingsPage() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [dailyImageId, setDailyImageId] = useState('');
  const [alert, setAlert] = useState<Alert>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingDaily, setIsSavingDaily] = useState(false);
  const [isSavingLevels, setIsSavingLevels] = useState(false);
  const [savingImageId, setSavingImageId] = useState('');
  const [uploadingAssetKey, setUploadingAssetKey] = useState('');

  const today = useMemo(() => todayKey(), []);
  const selectedDailyImage = useMemo(() => images.find((img) => img._id === dailyImageId) || null, [images, dailyImageId]);

  async function loadSettings() {
    setIsLoading(true);
    setAlert(null);
    try {
      const [configRes, imagesRes] = await Promise.all([
        fetch('/api/admin/game-config', { cache: 'no-store' }),
        fetch('/api/images?scope=public&limit=48', { cache: 'no-store' }),
      ]);

      const configJson = await configRes.json();
      if (!configRes.ok) throw new Error(configJson?.error || 'Failed to load game settings');

      const imagesJson = await imagesRes.json();
      if (!imagesRes.ok) throw new Error(imagesJson?.error || 'Failed to load public images');

      const loadedConfig = configJson.config as GameConfig;
      setConfig(loadedConfig);
      setImages(Array.isArray(imagesJson.data) ? imagesJson.data : []);
      setDailyImageId(loadedConfig?.dailyReward?.manualImageByDate?.[today] || '');
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDailyField<K extends keyof DailyRewardConfig>(key: K, value: DailyRewardConfig[K]) {
    setConfig((prev) => prev ? {
      ...prev,
      dailyReward: {
        ...prev.dailyReward,
        [key]: value,
      },
    } : prev);
  }

  function updateLevel(index: number, patch: Partial<GameLevel>) {
    setConfig((prev) => {
      if (!prev) return prev;
      const levels = prev.levels.map((level, idx) => idx === index ? { ...level, ...patch } : level);
      return { ...prev, levels };
    });
  }

  async function uploadGameAsset(file: File, purpose: string, assetKey: string): Promise<string> {
    setUploadingAssetKey(assetKey);
    setAlert(null);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('purpose', purpose);
      const res = await fetch('/api/admin/game-assets', { method: 'POST', body: form });
      const json = await res.json() as AssetUploadResponse;
      if (!res.ok || !json.asset?.url) {
        throw new Error(json?.error || json?.details || 'Failed to upload image');
      }
      setAlert({
        kind: 'success',
        text: `Image converted to WebP and compressed (${formatBytes(json.asset.sizeBytes)}). Save settings to apply it.`,
      });
      return json.asset.url;
    } finally {
      setUploadingAssetKey('');
    }
  }

  async function onDailyAssetChange(e: ChangeEvent<HTMLInputElement>, field: 'iconImageUrl' | 'specialPackImageUrl', purpose: string, assetKey: string) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const url = await uploadGameAsset(file, purpose, assetKey);
      updateDailyField(field, url as any);
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    }
  }

  async function onLevelAssetChange(e: ChangeEvent<HTMLInputElement>, index: number, levelId: string) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const url = await uploadGameAsset(file, `level-${levelId}`, `level-${levelId}`);
      updateLevel(index, { iconImageUrl: url });
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    }
  }

  async function saveDailySettings() {
    if (!config) return;
    setIsSavingDaily(true);
    setAlert(null);
    try {
      const res = await fetch('/api/admin/game-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyReward: {
            ...config.dailyReward,
            manualImageByDate: {
              [today]: dailyImageId,
            },
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to save daily settings');
      setConfig(json.config);
      setDailyImageId(json.config?.dailyReward?.manualImageByDate?.[today] || '');
      setAlert({ kind: 'success', text: 'Daily puzzle and reward settings saved.' });
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setIsSavingDaily(false);
    }
  }

  async function saveLevels() {
    if (!config) return;
    setIsSavingLevels(true);
    setAlert(null);
    try {
      const res = await fetch('/api/admin/game-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levels: config.levels }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to save levels');
      setConfig(json.config);
      setAlert({ kind: 'success', text: 'Level system saved.' });
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setIsSavingLevels(false);
    }
  }

  async function saveImageLevel(imageId: string, levelId: string) {
    setSavingImageId(imageId);
    setAlert(null);
    try {
      const res = await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to assign image level');
      setImages((prev) => prev.map((img) => img._id === imageId ? { ...img, levelId: levelId || null } : img));
      setAlert({ kind: 'success', text: 'Image level updated.' });
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: getErrorMessage(err) });
    } finally {
      setSavingImageId('');
    }
  }

  if (!config && isLoading) {
    return <main><h1>Game Settings</h1><div className="card">Loading settings…</div></main>;
  }

  return (
    <main>
      <div className="pageHeader">
        <div>
          <h1>Game Settings</h1>
          <p className="help" style={{ fontSize: 14 }}>
            Manage Daily Puzzle / Daily Reward and the Level System from the backend UI.
          </p>
        </div>
        <button className="secondary" onClick={loadSettings} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {alert && <div className={`alert ${alert.kind}`} style={{ marginTop: 14 }}>{alert.text}</div>}

      {!config ? (
        <div className="card" style={{ marginTop: 16 }}>Could not load settings.</div>
      ) : (
        <>
          <section className="card featureCard" style={{ marginTop: 16 }}>
            <div className="featureTitleRow">
              <div>
                <span className="featureBadge">1</span>
                <h2>Daily Puzzle / Daily Reward</h2>
                <p className="help">Set reward coins, special pack reward, daily icon image, and today’s fixed puzzle.</p>
              </div>
              <button onClick={saveDailySettings} disabled={isSavingDaily || Boolean(uploadingAssetKey)}>
                {isSavingDaily ? 'Saving…' : 'Save Daily Settings'}
              </button>
            </div>

            <div className="settingsGrid">
              <label>
                Daily coins
                <input
                  type="number"
                  min={0}
                  max={99999}
                  value={config.dailyReward.rewardCoins}
                  onChange={(e) => updateDailyField('rewardCoins', Number(e.currentTarget.value) || 0)}
                />
              </label>
              <label>
                Streak reward days
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={config.dailyReward.streakRewardDays}
                  onChange={(e) => updateDailyField('streakRewardDays', Number(e.currentTarget.value) || 1)}
                />
              </label>
              <label>
                Special pack ID
                <input
                  type="text"
                  value={config.dailyReward.specialPackId}
                  onChange={(e) => updateDailyField('specialPackId', e.currentTarget.value)}
                />
              </label>
              <label>
                Special pack name
                <input
                  type="text"
                  value={config.dailyReward.specialPackName}
                  onChange={(e) => updateDailyField('specialPackName', e.currentTarget.value)}
                />
              </label>
            </div>

            <div className="assetUploadGrid">
              <div className="assetUploadCard">
                <div className="assetPreviewBox">
                  {config.dailyReward.iconImageUrl ? <img src={config.dailyReward.iconImageUrl} alt="Daily challenge icon" /> : <span>Daily</span>}
                </div>
                <div>
                  <strong>Daily challenge image</strong>
                  <p className="help">Used as the Daily Puzzle / reward badge image. Uploaded files are converted to compressed WebP.</p>
                  <label className="uploadButton">
                    {uploadingAssetKey === 'daily-icon' ? 'Compressing…' : 'Upload image'}
                    <input type="file" accept="image/*" onChange={(e) => onDailyAssetChange(e, 'iconImageUrl', 'daily-challenge-icon', 'daily-icon')} disabled={Boolean(uploadingAssetKey)} />
                  </label>
                  {config.dailyReward.iconImageUrl ? (
                    <button className="secondary smallBtn" onClick={() => updateDailyField('iconImageUrl', null as any)} type="button">Remove</button>
                  ) : null}
                  <small>{assetLabel(config.dailyReward.iconImageUrl)}</small>
                </div>
              </div>

              <div className="assetUploadCard">
                <div className="assetPreviewBox">
                  {config.dailyReward.specialPackImageUrl ? <img src={config.dailyReward.specialPackImageUrl} alt="Special pack reward" /> : <span>Pack</span>}
                </div>
                <div>
                  <strong>7-day special pack image</strong>
                  <p className="help">Image for the streak unlock reward. Also saved as compressed WebP.</p>
                  <label className="uploadButton">
                    {uploadingAssetKey === 'special-pack' ? 'Compressing…' : 'Upload image'}
                    <input type="file" accept="image/*" onChange={(e) => onDailyAssetChange(e, 'specialPackImageUrl', 'daily-streak-pack-icon', 'special-pack')} disabled={Boolean(uploadingAssetKey)} />
                  </label>
                  {config.dailyReward.specialPackImageUrl ? (
                    <button className="secondary smallBtn" onClick={() => updateDailyField('specialPackImageUrl', null as any)} type="button">Remove</button>
                  ) : null}
                  <small>{assetLabel(config.dailyReward.specialPackImageUrl)}</small>
                </div>
              </div>
            </div>

            <div className="dailyPicker">
              <div>
                <h3>Today’s puzzle</h3>
                <p className="help">Date: <strong>{today}</strong>. Choose a fixed coloring image or leave Auto selection.</p>
                <select value={dailyImageId} onChange={(e) => setDailyImageId(e.currentTarget.value)}>
                  <option value="">Auto select by date</option>
                  {images.map((image) => (
                    <option key={image._id} value={image._id}>{imageLabel(image)} · {image._id.slice(-6)}</option>
                  ))}
                </select>
              </div>
              <div className="dailyPreview">
                {selectedDailyImage?.pngData ? <img src={selectedDailyImage.pngData} alt="Selected daily puzzle" /> : <div className="emptyPreview">Auto</div>}
                <small>{selectedDailyImage ? imageLabel(selectedDailyImage) : 'Backend will choose a puzzle automatically.'}</small>
              </div>
            </div>
          </section>

          <section className="card featureCard" style={{ marginTop: 16 }}>
            <div className="featureTitleRow">
              <div>
                <span className="featureBadge">2</span>
                <h2>Level System</h2>
                <p className="help">Edit level images, names, unlock rules, and keywords used for automatic image grouping.</p>
              </div>
              <button onClick={saveLevels} disabled={isSavingLevels || Boolean(uploadingAssetKey)}>
                {isSavingLevels ? 'Saving…' : 'Save Levels'}
              </button>
            </div>

            <div className="levelEditorGrid">
              {config.levels.map((level, index) => (
                <div className="levelEditorCard" key={level.id}>
                  <div className="levelEditorHead">
                    <span className="levelIconPreview">
                      {level.iconImageUrl ? <img src={level.iconImageUrl} alt={`${level.name} icon`} /> : level.emoji}
                    </span>
                    <div>
                      <strong>{level.name}</strong>
                      <small>{level.id}</small>
                    </div>
                  </div>

                  <div className="levelAssetRow">
                    <div className="assetPreviewBox small">
                      {level.iconImageUrl ? <img src={level.iconImageUrl} alt={`${level.name} uploaded icon`} /> : <span>{level.emoji}</span>}
                    </div>
                    <div>
                      <strong>Level image</strong>
                      <p className="help">Upload instead of emoji. It will be converted to compressed WebP.</p>
                      <label className="uploadButton">
                        {uploadingAssetKey === `level-${level.id}` ? 'Compressing…' : 'Upload image'}
                        <input type="file" accept="image/*" onChange={(e) => onLevelAssetChange(e, index, level.id)} disabled={Boolean(uploadingAssetKey)} />
                      </label>
                      {level.iconImageUrl ? (
                        <button className="secondary smallBtn" onClick={() => updateLevel(index, { iconImageUrl: null })} type="button">Remove</button>
                      ) : null}
                      <small>{assetLabel(level.iconImageUrl)}</small>
                    </div>
                  </div>

                  <div className="settingsGrid compact">
                    <label>
                      Level name
                      <input type="text" value={level.name} onChange={(e) => updateLevel(index, { name: e.currentTarget.value })} />
                    </label>
                    <label>
                      Short name
                      <input type="text" value={level.shortName} onChange={(e) => updateLevel(index, { shortName: e.currentTarget.value })} />
                    </label>
                    <label>
                      Unlock next after
                      <input type="number" min={0} max={99} value={level.requiredToUnlockNext} onChange={(e) => updateLevel(index, { requiredToUnlockNext: Number(e.currentTarget.value) || 0 })} />
                    </label>
                  </div>
                  <label>
                    Description
                    <input type="text" value={level.description} onChange={(e) => updateLevel(index, { description: e.currentTarget.value })} />
                  </label>
                  <label>
                    Auto-group keywords
                    <textarea value={keywordsToText(level)} onChange={(e) => updateLevel(index, { keywords: textToKeywords(e.currentTarget.value) })} />
                  </label>
                </div>
              ))}
            </div>
          </section>

          <section className="card featureCard" style={{ marginTop: 16 }}>
            <div className="featureTitleRow">
              <div>
                <h2>Assign Images to Levels</h2>
                <p className="help">Manual assignment overrides keyword-based automatic grouping.</p>
              </div>
            </div>

            <div className="imageAssignGrid">
              {images.map((image) => (
                <div className="imageAssignCard" key={image._id}>
                  {image.pngData ? <img src={image.pngData} alt={imageLabel(image)} /> : <div className="emptyPreview">No preview</div>}
                  <strong>{imageLabel(image)}</strong>
                  <small>{image._id}</small>
                  <div className="row" style={{ marginTop: 8 }}>
                    <select value={image.levelId || ''} onChange={(e) => saveImageLevel(image._id, e.currentTarget.value)} disabled={savingImageId === image._id}>
                      <option value="">Auto by keywords</option>
                      {config.levels.map((level) => <option key={level.id} value={level.id}>{level.iconImageUrl ? '🖼️' : level.emoji} {level.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              {!images.length ? <div className="help">No public images found yet.</div> : null}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
