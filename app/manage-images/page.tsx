"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  getFirebaseClientAuth,
  hasFirebasePublicConfig,
  signInWithGooglePopup,
  signOutFirebase,
} from "@/lib/firebaseClient";

type Category = { _id: string; name: string };

type ImageRecord = {
  _id: string;
  userId?: string;
  pngData?: string;
  svgData?: string;
  hasSvgData?: boolean;
  colors?: string[];
  categories?: string[];
  hasSimplifiedSvg?: boolean;
  createdAt?: string;
  updatedAt?: string;
  date?: string;
};

type Alert = { kind: "success" | "error" | "info"; text: string } | null;

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function isHexColor(s: string) {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s);
}

function parseColorsText(input: string): {
  colors: string[];
  invalid: string[];
} {
  const raw = input
    .split(/[\n,]/g)
    .map((c) => c.trim())
    .filter(Boolean);

  const colors: string[] = [];
  const invalid: string[] = [];
  for (const c of raw) {
    if (isHexColor(c)) colors.push(c.toUpperCase());
    else invalid.push(c);
  }
  return { colors: Array.from(new Set(colors)).slice(0, 64), invalid };
}

function SwatchRow({ colors }: { colors: string[] }) {
  if (!colors?.length) return <small>No palette</small>;
  return (
    <div className="chips" style={{ gap: 6 }}>
      {colors.slice(0, 32).map((c) => (
        <span key={c} className="chip" style={{ padding: "4px 8px" }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: c,
              border: "1px solid #e5e7eb",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          >
            {c}
          </span>
        </span>
      ))}
      {colors.length > 32 ? <small>+{colors.length - 32} more</small> : null}
    </div>
  );
}

function CategoryChips({
  categories,
  categoryMap,
}: {
  categories: string[];
  categoryMap: Map<string, string>;
}) {
  if (!categories?.length) return <small>No categories</small>;
  return (
    <div className="chips">
      {categories.slice(0, 12).map((id) => (
        <span key={id} className="chip">
          {categoryMap.get(id) || id}
        </span>
      ))}
      {categories.length > 12 ? (
        <small>+{categories.length - 12} more</small>
      ) : null}
    </div>
  );
}

function formatDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function downloadHref(id: string, kind: "svg" | "palette" | "webp") {
  return `/api/images/${encodeURIComponent(id)}/download?kind=${kind}`;
}

function ImageGridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid" aria-label="Loading images">
      {Array.from({ length: Math.max(1, Math.min(count, 12)) }).map(
        (_, idx) => (
          <div className="card skeletonCard" key={idx}>
            <div className="skeletonLine short" />
            <div className="skeletonLine" />
            <div className="skeletonPreview" />
            <div className="skeletonLine" />
            <div className="skeletonLine medium" />
          </div>
        ),
      )}
    </div>
  );
}

export default function ManageImagesPage() {
  const [scope, setScope] = useState<"public" | "mine" | "all">("public");
  const [firebaseToken, setFirebaseToken] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminEmailDraft, setAdminEmailDraft] = useState("");
  const firebaseConfigured = hasFirebasePublicConfig();

  const [categories, setCategories] = useState<Category[]>([]);
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c._id, c.name] as const)),
    [categories],
  );

  const [page, setPage] = useState(1);
  const [pageLimit, setPageLimit] = useState(12);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([""]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);

  function authHeaders(
    extra?: Record<string, string>,
    token = firebaseToken,
  ): Record<string, string> {
    const email = adminEmail.trim().toLowerCase();
    return {
      ...(extra || {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(email ? { "x-admin-email": email } : {}),
    };
  }

  function saveAdminEmailLogin() {
    const email = adminEmailDraft.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setAlert({ kind: "error", text: "Enter a valid admin email." });
      return;
    }
    localStorage.setItem("manageImagesAdminEmail", email);
    setAdminEmail(email);
    setAdminEmailDraft(email);
    setAlert({ kind: "success", text: `Admin email login active: ${email}` });
  }

  function clearAdminEmailLogin() {
    localStorage.removeItem("manageImagesAdminEmail");
    setAdminEmail("");
    setAdminEmailDraft("");
    if (!currentUser && scope !== "public") setScope("public");
    setAlert({ kind: "info", text: "Admin email login cleared" });
  }

  async function refreshFirebaseToken(user = currentUser): Promise<string> {
    if (!user) return "";
    const token = await user.getIdToken();
    setFirebaseToken(token);
    return token;
  }

  async function signInWithGoogle() {
    setIsAuthBusy(true);
    setAlert(null);
    try {
      const result = await signInWithGooglePopup();
      const token = await result.user.getIdToken();
      setCurrentUser(result.user);
      setFirebaseToken(token);
      setAlert({
        kind: "success",
        text: `Signed in as ${result.user.email || result.user.displayName || "Google user"}`,
      });
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Google sign-in failed: ${getErrorMessage(err)}`,
      });
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function signOutGoogle() {
    setIsAuthBusy(true);
    setAlert(null);
    try {
      await signOutFirebase();
      setCurrentUser(null);
      setFirebaseToken("");
      if (!adminEmail && scope !== "public") setScope("public");
      setAlert({ kind: "info", text: "Signed out of Google" });
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Sign out failed: ${getErrorMessage(err)}`,
      });
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function fetchCategories() {
    try {
      const res = await fetch("/api/categories");
      const json = (await res.json()) as {
        categories?: Category[];
        error?: string;
      };
      if (!res.ok) throw new Error(json?.error || "Failed to fetch categories");
      const all = Array.isArray(json.categories) ? json.categories : [];
      // Keep virtual categories out of the editor list (they are not stored in DB)
      setCategories(all.filter((c) => c._id !== "all" && c._id !== "new"));
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Error fetching categories: ${getErrorMessage(err)}`,
      });
    }
  }

  async function fetchImages(options?: {
    after?: string;
    pageNumber?: number;
    reset?: boolean;
  }) {
    const requestedPage = options?.pageNumber || 1;
    const after = options?.after || "";

    setIsLoading(true);
    setAlert(null);
    try {
      const token = currentUser
        ? await refreshFirebaseToken(currentUser)
        : firebaseToken;
      const params = new URLSearchParams({
        scope,
        limit: String(pageLimit),
      });
      if (after) params.set("after", after);

      const res = await fetch(`/api/images?${params.toString()}`, {
        headers: authHeaders(undefined, token),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json?.error || "Failed to fetch images");

      setImages(Array.isArray(json.data) ? json.data : []);
      setPage(requestedPage);
      setNextCursor(
        typeof json.nextCursor === "string" ? json.nextCursor : null,
      );
      setHasNextPage(Boolean(json.hasNext));

      if (options?.reset) {
        setCursorHistory([""]);
      }
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Error fetching images: ${getErrorMessage(err)}`,
      });
      setImages([]);
      setNextCursor(null);
      setHasNextPage(false);
    } finally {
      setIsLoading(false);
    }
  }

  function loadFirstPage() {
    setCursorHistory([""]);
    fetchImages({ after: "", pageNumber: 1, reset: true });
  }

  function loadNextPage() {
    if (!nextCursor) return;
    const targetPage = page + 1;
    setCursorHistory((prev) => {
      const copy = prev.slice(0, targetPage - 1);
      copy[targetPage - 1] = nextCursor;
      return copy;
    });
    fetchImages({ after: nextCursor, pageNumber: targetPage });
  }

  function loadPreviousPage() {
    if (page <= 1) return;
    const targetPage = page - 1;
    const after = cursorHistory[targetPage - 1] || "";
    fetchImages({ after, pageNumber: targetPage });
  }

  async function loadFullImageDetails(id: string) {
    const token = currentUser
      ? await refreshFirebaseToken(currentUser)
      : firebaseToken;
    const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
      headers: authHeaders(undefined, token),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(json?.error || "Failed to load image details");
    const record = json as ImageRecord;
    setImages((prev) =>
      prev.map((img) => (img._id === id ? { ...img, ...record } : img)),
    );
    return record;
  }

  useEffect(() => {
    const savedEmail = localStorage.getItem("manageImagesAdminEmail") || "";
    if (savedEmail) {
      setAdminEmail(savedEmail);
      setAdminEmailDraft(savedEmail);
    }

    if (!firebaseConfigured) return undefined;

    try {
      const auth = getFirebaseClientAuth();
      return onAuthStateChanged(auth, async (user) => {
        setCurrentUser(user);
        if (user) {
          try {
            const token = await user.getIdToken();
            setFirebaseToken(token);
          } catch (err: unknown) {
            setAlert({
              kind: "error",
              text: `Could not read Google session: ${getErrorMessage(err)}`,
            });
          }
        } else {
          setFirebaseToken("");
        }
      });
    } catch (err: unknown) {
      setAlert({ kind: "error", text: getErrorMessage(err) });
      return undefined;
    }
  }, [firebaseConfigured]);

  useEffect(() => {
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, pageLimit, firebaseToken, adminEmail]);

  async function saveMeta(
    id: string,
    colors: string[],
    categoriesIds: string[],
    hasSimplifiedSvg: boolean,
  ) {
    setAlert(null);
    try {
      const token = currentUser
        ? await refreshFirebaseToken(currentUser)
        : firebaseToken;
      const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }, token),
        body: JSON.stringify({
          colors,
          categories: categoriesIds,
          hasSimplifiedSvg,
        }),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json?.error || "Failed to update");

      setImages((prev) =>
        prev.map((r) =>
          r._id === id
            ? {
                ...r,
                colors,
                categories: categoriesIds,
                hasSimplifiedSvg,
                updatedAt: new Date().toISOString(),
              }
            : r,
        ),
      );
      setAlert({ kind: "success", text: "Details updated" });
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Update failed: ${getErrorMessage(err)}`,
      });
    }
  }

  async function replaceFiles(id: string, fd: FormData) {
    setAlert(null);
    try {
      const token = currentUser
        ? await refreshFirebaseToken(currentUser)
        : firebaseToken;
      const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: authHeaders(undefined, token),
        body: fd,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json?.error || "Failed to replace");

      if (json.record) {
        setImages((prev) =>
          prev.map((r) =>
            r._id === id ? { ...r, ...(json.record as ImageRecord) } : r,
          ),
        );
      }
      await loadFullImageDetails(id);
      setAlert({ kind: "success", text: "Files replaced" });
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Replace failed: ${getErrorMessage(err)}`,
      });
    }
  }

  async function deleteImage(id: string) {
    setAlert(null);
    const ok = window.confirm("Delete this image record and its files?");
    if (!ok) return;

    try {
      const token = currentUser
        ? await refreshFirebaseToken(currentUser)
        : firebaseToken;
      const res = await fetch(
        `/api/deleteimage?id=${encodeURIComponent(id)}&collection=svgdata`,
        {
          method: "DELETE",
          headers: authHeaders(undefined, token),
        },
      );
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json?.error || "Failed to delete");

      setImages((prev) => prev.filter((r) => r._id !== id));
      setAlert({ kind: "success", text: "Deleted" });
    } catch (err: unknown) {
      setAlert({
        kind: "error",
        text: `Delete failed: ${getErrorMessage(err)}`,
      });
    }
  }

  return (
    <main>
      <h1>Manage Uploaded Images</h1>
      <p style={{ marginTop: -8 }}>
        Browse in small pages. The list API uses cursor pagination and does not
        run a total-count query on every refresh.
      </p>

      {alert && (
        <div className={`alert ${alert.kind}`} style={{ marginTop: 12 }}>
          {alert.text}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700 }}>Protected area</div>
        <div className="help">
          You are already logged in from the main login page. All
          image-management actions now use the signed login cookie.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row">
          <label>
            View
            <div>
              <select
                value={scope}
                onChange={(e) => setScope(e.currentTarget.value as any)}
                style={{
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 12,
                  minWidth: 280,
                }}
              >
                <option value="public">Public library</option>
                <option value="mine">My works</option>
                <option value="all">All / admin view</option>
              </select>
            </div>
            <div className="help">
              All / admin view and public-item editing are allowed only for
              emails listed in ADMIN_EMAILS.
            </div>
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <label>
            Per page
            <div>
              <select
                value={pageLimit}
                onChange={(e) =>
                  setPageLimit(Number(e.currentTarget.value) || 12)
                }
                style={{
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 12,
                  minWidth: 140,
                }}
              >
                <option value={6}>6</option>
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
            </div>
          </label>

          <button onClick={loadFirstPage} disabled={isLoading}>
            {isLoading ? "Loading…" : "Refresh"}
          </button>

          <button
            className="secondary"
            onClick={loadFirstPage}
            disabled={isLoading || page <= 1}
          >
            First
          </button>
          <button
            className="secondary"
            onClick={loadPreviousPage}
            disabled={isLoading || page <= 1}
          >
            Prev
          </button>
          <button
            className="secondary"
            onClick={loadNextPage}
            disabled={isLoading || !hasNextPage || !nextCursor}
          >
            Next
          </button>
          <small>
            Page {page} · showing up to {pageLimit} records{" "}
            {hasNextPage ? "· more available" : "· end of list"}
          </small>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {isLoading ? (
          <ImageGridSkeleton count={pageLimit} />
        ) : (
          <div className="grid">
            {images.map((img) => (
              <ImageCard
                key={img._id}
                img={img}
                categories={categories}
                categoryMap={categoryMap}
                onSaveMeta={saveMeta}
                onReplaceFiles={replaceFiles}
                onDelete={deleteImage}
                onLoadDetails={loadFullImageDetails}
              />
            ))}
          </div>
        )}
        {images.length === 0 && !isLoading ? (
          <small>No images found.</small>
        ) : null}
      </div>
    </main>
  );
}

function ImageCard({
  img,
  categories,
  categoryMap,
  onSaveMeta,
  onReplaceFiles,
  onDelete,
  onLoadDetails,
}: {
  img: ImageRecord;
  categories: Category[];
  categoryMap: Map<string, string>;
  onSaveMeta: (
    id: string,
    colors: string[],
    categoriesIds: string[],
    hasSimplifiedSvg: boolean,
  ) => Promise<void>;
  onReplaceFiles: (id: string, fd: FormData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLoadDetails: (id: string) => Promise<ImageRecord>;
}) {
  const [open, setOpen] = useState(false);

  const [colorsText, setColorsText] = useState((img.colors || []).join("\n"));
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    Array.isArray(img.categories) ? img.categories : [],
  );
  const [hasSimplifiedSvg, setHasSimplifiedSvg] = useState(
    Boolean(img.hasSimplifiedSvg),
  );

  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [isThumbLoaded, setIsThumbLoaded] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    setColorsText((img.colors || []).join("\n"));
    setSelectedCategories(Array.isArray(img.categories) ? img.categories : []);
    setHasSimplifiedSvg(Boolean(img.hasSimplifiedSvg));
    setIsThumbLoaded(false);
    setThumbError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img._id, img.updatedAt, img.pngData, img.svgData]);

  const parsed = useMemo(() => parseColorsText(colorsText), [colorsText]);

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSaveMeta() {
    if (parsed.invalid.length > 0) {
      window.alert(`Fix invalid colors: ${parsed.invalid.join(", ")}`);
      return;
    }
    if (parsed.colors.length === 0) {
      window.alert("At least one hex color is required.");
      return;
    }

    setIsBusy(true);
    try {
      await onSaveMeta(
        img._id,
        parsed.colors,
        selectedCategories,
        hasSimplifiedSvg,
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReplace() {
    if (!svgFile && !imageFile) {
      window.alert("Select an SVG and/or a preview image to replace.");
      return;
    }
    if (parsed.invalid.length > 0) {
      window.alert(`Fix invalid colors: ${parsed.invalid.join(", ")}`);
      return;
    }
    if (parsed.colors.length === 0) {
      window.alert("At least one hex color is required.");
      return;
    }

    const fd = new FormData();
    if (svgFile) fd.append("svgFile", svgFile);
    if (imageFile) fd.append("imageFile", imageFile);
    fd.append("colors", JSON.stringify(parsed.colors));
    fd.append("categories", JSON.stringify(selectedCategories));
    fd.append("hasSimplifiedSvg", String(hasSimplifiedSvg));

    setIsBusy(true);
    try {
      await onReplaceFiles(img._id, fd);
      setSvgFile(null);
      setImageFile(null);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleToggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    setDetailError("");

    if (!nextOpen || img.svgData) return;

    setIsLoadingDetails(true);
    try {
      await onLoadDetails(img._id);
    } catch (err: unknown) {
      setDetailError(getErrorMessage(err));
    } finally {
      setIsLoadingDetails(false);
    }
  }

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{ fontSize: 13, color: "#6b7280", wordBreak: "break-all" }}
          >
            {img._id}
          </div>
          <div style={{ marginTop: 4 }}>
            <small>Created: {formatDate(img.createdAt || img.date)}</small>
          </div>
          <div style={{ marginTop: 6 }}>
            <small>
              {img.userId ? `Private (userId: ${img.userId})` : "Public"}
            </small>
          </div>
        </div>
        <button
          className="secondary"
          onClick={handleToggleOpen}
          disabled={isLoadingDetails}
        >
          {isLoadingDetails ? "Loading…" : open ? "Close" : "Edit"}
        </button>
      </div>

      {img.pngData ? (
        <div className="previewWrap" style={{ marginTop: 10 }}>
          {!isThumbLoaded && !thumbError ? (
            <div className="thumbLoader">Loading preview…</div>
          ) : null}
          {thumbError ? (
            <div className="thumbError">Preview image could not load.</div>
          ) : null}
          <img
            className={`preview ${isThumbLoaded ? "isLoaded" : "isLoading"}`}
            src={img.pngData}
            alt="preview"
            loading="lazy"
            decoding="async"
            onLoad={() => setIsThumbLoaded(true)}
            onError={() => setThumbError(true)}
          />
        </div>
      ) : (
        <div className="previewWrap emptyPreview" style={{ marginTop: 10 }}>
          No preview image
        </div>
      )}

      <div className="downloadRow" style={{ marginTop: 10 }}>
        {img.hasSvgData || img.svgData ? (
          <a className="downloadBtn" href={downloadHref(img._id, "svg")}>
            Download SVG
          </a>
        ) : null}
        {Array.isArray(img.colors) && img.colors.length > 0 ? (
          <a className="downloadBtn" href={downloadHref(img._id, "palette")}>
            Download palette
          </a>
        ) : null}
        {img.pngData ? (
          <a className="downloadBtn" href={downloadHref(img._id, "webp")}>
            Download WebP
          </a>
        ) : null}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
          Palette
        </div>
        <SwatchRow colors={Array.isArray(img.colors) ? img.colors : []} />
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
          Categories
        </div>
        <CategoryChips
          categories={Array.isArray(img.categories) ? img.categories : []}
          categoryMap={categoryMap}
        />
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {detailError ? (
            <div className="alert error">
              Could not load full details: {detailError}
            </div>
          ) : null}
          <hr
            style={{
              border: 0,
              borderTop: "1px solid #e5e7eb",
              margin: "12px 0",
            }}
          />

          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Edit details
          </div>

          <label style={{ width: "100%" }}>
            Palette colors (one per line)
            <div>
              <textarea
                value={colorsText}
                onChange={(e) => setColorsText(e.currentTarget.value)}
              />
            </div>
            {parsed.invalid.length > 0 ? (
              <div className="help" style={{ color: "#991b1b" }}>
                Invalid: {parsed.invalid.join(", ")}
              </div>
            ) : null}
          </label>

          <div style={{ marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={hasSimplifiedSvg}
                onChange={(e) => setHasSimplifiedSvg(e.currentTarget.checked)}
              />
              Has simplified SVG
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
              Select categories
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              {categories.map((c) => (
                <label
                  key={c._id}
                  className="chip"
                  style={{ cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(c._id)}
                    onChange={() => toggleCategory(c._id)}
                    style={{ marginRight: 8 }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={handleSaveMeta} disabled={isBusy}>
              {isBusy ? "Saving…" : "Save details"}
            </button>
            <button
              className="secondary"
              onClick={() => onDelete(img._id)}
              disabled={isBusy}
            >
              Delete
            </button>
          </div>

          <hr
            style={{
              border: 0,
              borderTop: "1px solid #e5e7eb",
              margin: "14px 0",
            }}
          />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Replace files
          </div>

          <label style={{ width: "100%" }}>
            Replace SVG (optional)
            <div>
              <input
                type="file"
                accept=".svg,image/svg+xml"
                onChange={(e) => setSvgFile(e.target.files?.[0] || null)}
              />
            </div>
          </label>

          <label style={{ width: "100%", marginTop: 8 }}>
            Replace preview image (PNG/JPG/WebP) (optional)
            <div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              />
            </div>
          </label>

          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={handleReplace} disabled={isBusy}>
              {isBusy ? "Replacing…" : "Replace selected files"}
            </button>
            {img.svgData ? (
              <a
                href={img.svgData}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13 }}
              >
                Open SVG
              </a>
            ) : null}
            {img.hasSvgData || img.svgData ? (
              <a href={downloadHref(img._id, "svg")} style={{ fontSize: 13 }}>
                Download SVG
              </a>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
