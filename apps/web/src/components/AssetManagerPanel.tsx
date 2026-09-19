import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createAssetCategory,
  deleteAssetCategory,
  deleteAssetVariationRequest,
  deleteManagedAssetRequest,
  fetchAssetWorkspace,
  formatApiError,
  moveAssetCategory,
  moveManagedAssetRequest,
  saveAssetSettings,
  setAssetVariationUsage,
  updateAssetCategoryMetadata,
  updateAssetCategorySettings,
  updateAssetMetadata,
  uploadAssetVariation,
  uploadManagedAsset,
  type AssetWorkspaceData,
} from "../lib/registry.js";
import type { AgentProfile, AssetBucket, AssetBucketColor, AssetMetadata, AssetVariation, ManagedAsset } from "../lib/types.js";
import "./AssetManager.css";

const UNCATEGORIZED_BUCKET_ID = "uncategorized";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.HTMLAttributes<HTMLElement> & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean;
        "auto-rotate"?: boolean;
        "interaction-prompt"?: string;
        "shadow-intensity"?: string;
      };
    }
  }
}

type Preset = "no_relation" | "page_based" | "type_based" | "custom";

const presets: Array<{ id: Preset; title: string; detail: string }> = [
  { id: "no_relation", title: "No relation", detail: "Manual" },
  { id: "page_based", title: "Page based", detail: "Route, screen, scene, level" },
  { id: "type_based", title: "Type based", detail: "Media or source type" },
];

const folderColors: Array<{ id: AssetBucketColor; label: string; value: string }> = [
  { id: "gray", label: "Gray", value: "#6b7280" },
  { id: "red", label: "Red", value: "#dc2626" },
  { id: "orange", label: "Orange", value: "#ea580c" },
  { id: "yellow", label: "Yellow", value: "#ca8a04" },
  { id: "green", label: "Green", value: "#16a34a" },
  { id: "blue", label: "Blue", value: "#2563eb" },
  { id: "purple", label: "Purple", value: "#9333ea" },
  { id: "pink", label: "Pink", value: "#db2777" },
];

function folderColorValue(color: AssetBucketColor): string {
  return folderColors.find((item) => item.id === color)?.value ?? folderColors[0]!.value;
}

const emptyMetadata = (): AssetMetadata => ({
  description: "",
  tags: [],
  fields: {},
  expose_to_agents: false,
});

function FormDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="k-dialog" style={{ width: "min(520px, 100%)" }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="k-dialog__header">
          {title}
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="k-dialog__body" style={{ display: "grid", gap: 10 }}>{children}</div>
      </section>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function metadataFieldsText(metadata: AssetMetadata): string {
  return Object.entries(metadata.fields).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseMetadata(description: string, tags: string, fields: string, expose: boolean): AssetMetadata {
  return {
    description: description.trim(),
    tags: tags.split(",").map((item) => item.trim()).filter(Boolean),
    fields: Object.fromEntries(
      fields.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.indexOf("=");
        return separator < 0 ? [line, ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
    ),
    expose_to_agents: expose,
  };
}

function previewUrl(projectId: string, assetId: string, variationId: string): string {
  return `/api/project/${encodeURIComponent(projectId)}/assets/items/${encodeURIComponent(assetId)}/variations/${encodeURIComponent(variationId)}/content`;
}

function primaryVariation(asset: ManagedAsset): AssetVariation | undefined {
  return asset.variations.find((variation) => variation.used) ?? asset.variations[0];
}

function VideoPreview({ src, label, large, interactive }: { src: string; label: string; large: boolean; interactive: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!video.current) return;
    if (video.current.paused) await video.current.play();
    else video.current.pause();
  };
  return (
    <div className="am__media">
      <video ref={video} src={src} muted playsInline loop={large} controls={large && interactive} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      {interactive && !large ? <button type="button" className="k-btn k-btn--sm am__media-btn" onClick={(event) => void toggle(event)} aria-label={`${playing ? "Pause" : "Play"} ${label}`}>{playing ? "❚❚" : "▶"}</button> : null}
    </div>
  );
}

function AudioPreview({ src, label, interactive }: { src: string; label: string; interactive: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!audio.current) return;
    if (audio.current.paused) await audio.current.play();
    else audio.current.pause();
  };
  return (
    <div className="am__tile">
      <strong>AUDIO</strong>
      <audio ref={audio} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      {interactive ? <button type="button" className="k-btn k-btn--sm" onClick={(event) => void toggle(event)} aria-label={`${playing ? "Pause" : "Play"} ${label}`}>{playing ? "❚❚" : "▶"}</button> : null}
    </div>
  );
}

function ModelPreview({ src, label }: { src: string; label: string }) {
  useEffect(() => { void import("@google/model-viewer"); }, []);
  return (
    <div className="am__media">
      <model-viewer src={src} alt={label} camera-controls auto-rotate interaction-prompt="none" shadow-intensity="1" className="am__model" />
      <span className="k-tag" style={{ position: "absolute", right: 6, bottom: 6 }}>3D</span>
    </div>
  );
}

function isDocumentVariation(variation: AssetVariation): "text" | "markdown" | "rtf" | "pdf" | null {
  const extension = variation.file_name.split(".").pop()?.toLowerCase();
  const mediaType = variation.media_type.toLowerCase();
  if (mediaType === "application/pdf" || extension === "pdf") return "pdf";
  if (mediaType === "text/markdown" || extension === "md" || extension === "markdown") return "markdown";
  if (mediaType === "text/rtf" || mediaType === "application/rtf" || mediaType === "application/x-rtf" || extension === "rtf") return "rtf";
  if (mediaType.startsWith("text/") || extension === "txt" || extension === "text") return "text";
  return null;
}

function rtfToText(value: string): string {
  return value
    .replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
    .replace(/\\u(-?\d+)\??/g, (_, code: string) => String.fromCharCode(Number(code) < 0 ? Number(code) + 65536 : Number(code)))
    .replace(/\\(par|line)\b/g, "\n")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function DocumentPreview({ src, kind }: { src: string; kind: "text" | "markdown" | "rtf" | "pdf" }) {
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "pdf") return;
    let active = true;
    setContent(null);
    setLoadError(null);
    void fetch(src)
      .then((response) => { if (!response.ok) throw new Error("Could not load document."); return response.text(); })
      .then((value) => { if (active) setContent(kind === "rtf" ? rtfToText(value) : value); })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : "Could not load document."); });
    return () => { active = false; };
  }, [kind, src]);

  if (kind === "pdf") return <iframe style={{ width: "100%", height: "100%", minHeight: 560, border: 0 }} src={src} title="PDF preview" />;
  if (loadError) return <div className="am__tile" style={{ minHeight: 420 }}><span className="k-error">{loadError}</span></div>;
  if (content === null) return <div className="am__tile" style={{ minHeight: 420 }}>…</div>;
  if (kind === "markdown") return <article className="am__doc"><div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div></article>;
  return <div className="am__doc"><pre>{content || "(empty)"}</pre></div>;
}

function AssetPreview({ projectId, asset, variation, large = false, interactive = true }: { projectId: string; asset: ManagedAsset; variation: AssetVariation | undefined; large?: boolean; interactive?: boolean }) {
  if (!variation) return <div className="am__tile"><span>EMPTY</span></div>;
  const source = previewUrl(projectId, asset.id, variation.id);
  const label = `${asset.name}: ${variation.name}`;
  if (variation.media_type.startsWith("image/")) return <img src={source} alt={label} style={large ? { objectFit: "contain" } : undefined} />;
  if (variation.media_type.startsWith("video/")) return <VideoPreview src={source} label={label} large={large} interactive={interactive} />;
  if (variation.media_type.startsWith("audio/")) return <AudioPreview src={source} label={label} interactive={interactive} />;
  if (variation.media_type.startsWith("model/")) return <ModelPreview src={source} label={label} />;
  const documentKind = isDocumentVariation(variation);
  if (large && documentKind) return <DocumentPreview src={source} kind={documentKind} />;
  const extension = variation.file_name.split(".").pop()?.toUpperCase() || "FILE";
  return <div className="am__tile"><strong style={{ fontSize: large ? 28 : 16 }}>{extension}</strong></div>;
}

function AssetDetailDialog({ projectId, asset, busy, onClose, onSetUsed, onDeleteVariation, onDeleteAsset }: { projectId: string; asset: ManagedAsset; busy: boolean; onClose: () => void; onSetUsed: (variationId: string, used: boolean) => void; onDeleteVariation: (variation: AssetVariation) => void; onDeleteAsset: () => void }) {
  const [variationId, setVariationId] = useState(() => primaryVariation(asset)?.id ?? "");
  const variation = asset.variations.find((item) => item.id === variationId) ?? primaryVariation(asset);

  useEffect(() => { setVariationId(primaryVariation(asset)?.id ?? ""); }, [asset.id]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="k-dialog am__detail" role="dialog" aria-modal="true" aria-label={asset.name}>
        <div className="am__detail-preview"><AssetPreview projectId={projectId} asset={asset} variation={variation} large /></div>
        <div className="am__detail-side">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong className="k-truncate" style={{ fontSize: 13 }}>{asset.name}</strong>
            <span className="k-spacer" />
            <button type="button" className="k-dialog__close" aria-label="Close" onClick={onClose}>×</button>
          </div>
          {asset.metadata.description ? <p className="k-note">{asset.metadata.description}</p> : null}
          <div style={{ display: "grid", gap: 4 }}>
            <span className="k-label">Variations</span>
            {asset.variations.map((item) => (
              <button key={item.id} type="button" className={`am__vchoice${item.id === variation?.id ? " am__vchoice--active" : ""}`} onClick={() => setVariationId(item.id)}>
                <span className="am__vthumb"><AssetPreview projectId={projectId} asset={asset} variation={item} interactive={false} /></span>
                <span className="k-truncate"><strong>{item.name}</strong> <span className="k-faint">{formatBytes(item.size_bytes)}</span></span>
                <span className="k-tag">{item.used ? "used" : "unused"}</span>
              </button>
            ))}
          </div>
          <div className="k-actions">
            {variation ? (
              <>
                <button type="button" className="k-btn k-btn--sm" disabled={busy} onClick={() => onSetUsed(variation.id, !variation.used)}>{variation.used ? "Mark unused" : "Mark used"}</button>
                <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={() => onDeleteVariation(variation)}>Delete variation</button>
              </>
            ) : null}
            <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={onDeleteAsset}>Delete asset</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetadataEditor({ title, value, busy, onSave }: { title: string; value: AssetMetadata; busy: boolean; onSave: (metadata: AssetMetadata) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(value.description);
  const [tags, setTags] = useState(value.tags.join(", "));
  const [fields, setFields] = useState(metadataFieldsText(value));
  const [expose, setExpose] = useState(value.expose_to_agents);

  useEffect(() => {
    setDescription(value.description);
    setTags(value.tags.join(", "));
    setFields(metadataFieldsText(value));
    setExpose(value.expose_to_agents);
  }, [value]);

  if (!open) {
    return (
      <div className="am__meta-row">
        <span className="k-truncate">{value.description || "No metadata"}</span>
        <span className="k-tag">{value.expose_to_agents ? "shared" : "private"}</span>
        <span className="k-spacer" />
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setOpen(true)}>Edit {title}</button>
      </div>
    );
  }

  return (
    <div className="am__meta-form">
      <div className="k-field"><label className="k-label">Description</label><textarea className="k-textarea" style={{ minHeight: 56 }} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div className="k-field-grid">
        <div className="k-field"><label className="k-label">Tags</label><input className="k-input" placeholder="comma separated" value={tags} onChange={(event) => setTags(event.target.value)} /></div>
        <div className="k-field"><label className="k-label">Fields</label><textarea className="k-textarea" style={{ minHeight: 56 }} placeholder="key=value per line" value={fields} onChange={(event) => setFields(event.target.value)} /></div>
      </div>
      <label className="k-check"><input type="checkbox" checked={expose} onChange={(event) => setExpose(event.target.checked)} />Expose to agents</label>
      <div className="k-actions" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="k-btn k-btn--sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="k-btn k-btn--sm k-btn--primary" disabled={busy} onClick={() => void onSave(parseMetadata(description, tags, fields, expose)).then((saved) => { if (saved) setOpen(false); })}>Save</button>
      </div>
    </div>
  );
}

function VariationUploader({ asset, busy, onUpload }: { asset: ManagedAsset; busy: boolean; onUpload: (assetId: string, file: File, name: string, used: boolean) => Promise<boolean> }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [used, setUsed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const submit = () => {
    setAttempted(true);
    if (!file) return;
    void onUpload(asset.id, file, name, used).then((uploaded) => {
      if (uploaded) { setFile(null); setName(""); setUsed(false); setAttempted(false); if (fileInput.current) fileInput.current.value = ""; }
    });
  };
  return (
    <div className="am__uploader">
      <div className="k-field">
        <label className="k-label">Add variation</label>
        <input ref={fileInput} className="k-input" style={attempted && !file ? { borderColor: "var(--danger)" } : undefined} type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
      <div className="k-field"><label className="k-label">Label</label><input className="k-input" value={name} placeholder="B, blue finish…" onChange={(event) => setName(event.target.value)} /></div>
      <label className="k-check" style={{ paddingBottom: 6 }}><input type="checkbox" checked={used} onChange={(event) => setUsed(event.target.checked)} />Used</label>
      <button type="button" className="k-btn" disabled={busy} onClick={submit}>Upload</button>
    </div>
  );
}


type FolderOption = { id: string; label: string; depth: number };

/** Root-first folder chain for `folderId`. Unknown ids yield []. */
function folderTrail(buckets: AssetBucket[], folderId: string | null): AssetBucket[] {
  const byId = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const trail: AssetBucket[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return trail;
}

function folderDescendants(buckets: AssetBucket[], folderId: string): Set<string> {
  const result = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const bucket of buckets) {
      if (bucket.parent_id === parent && !result.has(bucket.id)) { result.add(bucket.id); queue.push(bucket.id); }
    }
  }
  return result;
}

/** Depth-first folder list for selects, excluding the root archive and any ids in `omit`. */
function folderOptions(buckets: AssetBucket[], omit: Set<string> = new Set()): FolderOption[] {
  const options: FolderOption[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const bucket of buckets) {
      if (bucket.id === UNCATEGORIZED_BUCKET_ID || bucket.parent_id !== parentId || omit.has(bucket.id)) continue;
      options.push({ id: bucket.id, label: bucket.title, depth });
      walk(bucket.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
}

function FolderSelect({ value, options, includeRoot, invalid, onChange, autoFocus }: { value: string; options: FolderOption[]; includeRoot: boolean; invalid?: boolean; onChange: (value: string) => void; autoFocus?: boolean }) {
  return (
    <select className="k-select" style={invalid ? { borderColor: "var(--danger)" } : undefined} value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus}>
      {includeRoot ? <option value={UNCATEGORIZED_BUCKET_ID}>Assets</option> : null}
      {options.map((option) => <option key={option.id} value={option.id}>{`${"   ".repeat(option.depth)}${option.depth > 0 ? "└ " : ""}${option.label}`}</option>)}
    </select>
  );
}

function FolderIcon({ color = "gray" }: { color?: AssetBucketColor }) {
  return (
    <svg className="am__folder-icon" style={{ color: folderColorValue(color) }} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
    </svg>
  );
}

export function AssetManagerPanel({ projectId, profiles }: { projectId: string; profiles: AgentProfile[] }) {
  const [data, setData] = useState<AssetWorkspaceData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState("");
  const [folderInstruction, setFolderInstruction] = useState("");
  const [folderPreventAgentUploads, setFolderPreventAgentUploads] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetFolder, setAssetFolder] = useState(UNCATEGORIZED_BUCKET_ID);
  const [assetFiles, setAssetFiles] = useState<File[]>([]);
  const [assetUsed, setAssetUsed] = useState(true);
  const [uploadAttempted, setUploadAttempted] = useState(false);
  const assetFileInput = useRef<HTMLInputElement>(null);
  const [libraryView, setLibraryView] = useState<"grid" | "list">("grid");
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ kind: "asset"; asset: ManagedAsset } | { kind: "folder"; folder: AssetBucket } | null>(null);
  const [moveDestination, setMoveDestination] = useState(UNCATEGORIZED_BUCKET_ID);

  const reload = async () => setData(await fetchAssetWorkspace(projectId));
  useEffect(() => { void reload().catch((event) => setError(formatApiError(event))); }, [projectId]);
  useEffect(() => {
    if (activeFolderId && data && !data.library.buckets.some((bucket) => bucket.id === activeFolderId)) setActiveFolderId(null);
  }, [data, activeFolderId]);
  useEffect(() => { setEditingFolder(false); }, [activeFolderId]);
  useEffect(() => { if (selectedAssetId && data && !data.library.assets.some((asset) => asset.id === selectedAssetId)) setSelectedAssetId(null); }, [data, selectedAssetId]);

  const mutate = async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try { await action(); await reload(); return true; }
    catch (event) { setError(formatApiError(event)); return false; }
    finally { setBusy(false); }
  };

  if (!data) return <p className={error ? "k-error" : "k-empty"}>{error ?? "…"}</p>;

  const settings = data.settings;
  const buckets = data.library.buckets;
  const selectedAsset = selectedAssetId ? data.library.assets.find((asset) => asset.id === selectedAssetId) ?? null : null;
  const updateSettings = (patch: Partial<typeof settings>) => mutate(async () => { setData(await saveAssetSettings(projectId, { ...settings, ...patch })); });

  if (!settings.enabled) {
    return (
      <section className="k-section">
        <div className="k-section__header">Asset manager<span className="k-tag">off</span></div>
        <div className="k-section__body" style={{ display: "grid", gap: 12 }}>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-field">
            <span className="k-label">Organisation</span>
            <div className="am__presets">
              {presets.map((item) => (
                <button key={item.id} type="button" className={`am__preset${settings.preset === item.id ? " am__preset--active" : ""}`} onClick={() => setData({ ...data, settings: { ...settings, preset: item.id } })}>
                  <strong>{item.title}</strong>
                  <span className="k-faint">{item.detail}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="k-field">
            <span className="k-label">Profiles with asset access</span>
            <div className="k-checks">
              {profiles.length === 0 ? <p className="k-empty">No profiles</p> : profiles.map((profile) => (
                <label key={profile.id} className="k-check">
                  <input type="checkbox" checked={settings.selected_profile_ids.includes(profile.id)} onChange={() => setData({ ...data, settings: { ...settings, selected_profile_ids: settings.selected_profile_ids.includes(profile.id) ? settings.selected_profile_ids.filter((id) => id !== profile.id) : [...settings.selected_profile_ids, profile.id] } })} />
                  {profile.title}
                </label>
              ))}
            </div>
          </div>
          <div className="k-actions">
            <button type="button" className="k-btn k-btn--primary" disabled={busy || settings.selected_profile_ids.length === 0} onClick={() => void updateSettings({ enabled: true })}>Enable</button>
          </div>
        </div>
      </section>
    );
  }

  const trail = folderTrail(buckets, activeFolderId);
  const activeFolder = trail[trail.length - 1] ?? null;
  const currentBucketId = activeFolder?.id ?? UNCATEGORIZED_BUCKET_ID;
  const childFolders = buckets.filter((bucket) => bucket.id !== UNCATEGORIZED_BUCKET_ID && bucket.parent_id === activeFolderId);
  const folderAssets = data.library.assets.filter((asset) => asset.bucket_id === currentBucketId);
  const allOptions = folderOptions(buckets);
  const folderItemCount = (folderId: string) => buckets.filter((bucket) => bucket.parent_id === folderId).length + data.library.assets.filter((asset) => asset.bucket_id === folderId).length;

  const uploadNewAsset = async () => {
    const uploaded = await mutate(async () => {
      setUploadAttempted(true);
      const missing: string[] = [];
      if (!assetFolder) missing.push("folder");
      if (!assetName.trim()) missing.push("name");
      if (assetFiles.length === 0) missing.push("file");
      if (missing.length > 0) throw new Error(`Missing ${missing.join(", ")}.`);
      const [first, ...rest] = assetFiles;
      const created = await uploadManagedAsset(projectId, { bucket_id: assetFolder, name: assetName.trim(), metadata: emptyMetadata(), upload: { file_name: first!.name, media_type: first!.type, content_base64: await fileToBase64(first!), variation_name: first!.name, used: assetUsed } });
      for (const file of rest) await uploadAssetVariation(projectId, created.id, { file_name: file.name, media_type: file.type, content_base64: await fileToBase64(file), variation_name: file.name, used: assetUsed });
      setAssetName(""); setAssetFiles([]); setUploadAttempted(false); if (assetFileInput.current) assetFileInput.current.value = "";
    });
    if (uploaded) setUploadModalOpen(false);
  };

  const createFolder = async () => {
    const created = await mutate(async () => {
      await createAssetCategory(projectId, { title: folderTitle, parent_id: activeFolderId, preset: settings.preset, instruction: folderInstruction, prevent_agent_uploads: folderPreventAgentUploads, metadata: emptyMetadata() });
      setFolderTitle("");
      setFolderInstruction("");
      setFolderPreventAgentUploads(false);
    });
    if (created) setFolderModalOpen(false);
  };

  const deleteAsset = (asset: ManagedAsset) => window.confirm(`Delete "${asset.name}" and all variations?`) && void mutate(() => deleteManagedAssetRequest(projectId, asset.id));
  const deleteFolder = (folder: AssetBucket) => {
    const nested = folderDescendants(buckets, folder.id);
    const subtree = new Set([folder.id, ...nested]);
    const moved = data.library.assets.filter((asset) => subtree.has(asset.bucket_id)).length;
    const parts = [`Delete "${folder.title}"${nested.size ? ` and ${nested.size} subfolder${nested.size === 1 ? "" : "s"}` : ""}?`];
    if (moved) parts.push(`${moved} asset${moved === 1 ? "" : "s"} move to Assets root.`);
    if (!window.confirm(parts.join(" "))) return;
    void mutate(async () => {
      await deleteAssetCategory(projectId, folder.id);
      if (activeFolderId && subtree.has(activeFolderId)) setActiveFolderId(folder.parent_id);
    });
  };
  const openMove = (target: NonNullable<typeof moveTarget>) => {
    setError(null);
    setMoveDestination(target.kind === "asset" ? target.asset.bucket_id : target.folder.parent_id ?? UNCATEGORIZED_BUCKET_ID);
    setMoveTarget(target);
  };
  const submitMove = async () => {
    if (!moveTarget) return;
    const moved = await mutate(async () => {
      if (moveTarget.kind === "asset") await moveManagedAssetRequest(projectId, moveTarget.asset.id, moveDestination);
      else await moveAssetCategory(projectId, moveTarget.folder.id, moveDestination === UNCATEGORIZED_BUCKET_ID ? null : moveDestination);
    });
    if (moved) setMoveTarget(null);
  };
  const openUpload = () => { setError(null); setAssetFolder(currentBucketId); setUploadModalOpen(true); };
  const moveOptions = moveTarget?.kind === "folder" ? folderOptions(buckets, new Set([moveTarget.folder.id, ...folderDescendants(buckets, moveTarget.folder.id)])) : allOptions;

  const folderTile = (folder: AssetBucket) => (
    <div key={folder.id} className="am__folder">
      <button type="button" className="am__folder-open" onClick={() => setActiveFolderId(folder.id)} aria-label={`Open ${folder.title}`}>
        <FolderIcon color={folder.color} />
        <span className="k-truncate">{folder.title}</span>
        <span className="k-faint k-num">{folderItemCount(folder.id)}</span>
      </button>
      <button type="button" className="k-btn k-btn--ghost k-btn--sm am__folder-move" disabled={busy} title="Move folder" aria-label={`Move ${folder.title}`} onClick={() => openMove({ kind: "folder", folder })}>Move</button>
    </div>
  );

  return (
    <div className="am">
      {error ? <p className="k-error">{error}</p> : null}
      <section className="k-section">
        <div className="k-section__header am__header">
          <nav className="am__crumbs" aria-label="Folder path">
            {activeFolderId ? <button type="button" className="am__crumb" onClick={() => setActiveFolderId(null)}>Assets</button> : <span className="am__crumb am__crumb--current">Assets</span>}
            {trail.map((folder, index) => (
              <span key={folder.id} className="am__crumb-seg">
                <span className="am__crumb-sep" aria-hidden="true">›</span>
                {index === trail.length - 1
                  ? <span className="am__crumb am__crumb--current" aria-current="location">{folder.title}</span>
                  : <button type="button" className="am__crumb" onClick={() => setActiveFolderId(folder.id)}>{folder.title}</button>}
              </span>
            ))}
          </nav>
          <span className="k-section__count">{childFolders.length + folderAssets.length}</span>
          <span className="k-spacer" />
          <div className="k-seg" aria-label="View">
            <button type="button" className={`k-seg__btn${libraryView === "grid" ? " k-seg__btn--active" : ""}`} aria-pressed={libraryView === "grid"} onClick={() => setLibraryView("grid")}>Grid</button>
            <button type="button" className={`k-seg__btn${libraryView === "list" ? " k-seg__btn--active" : ""}`} aria-pressed={libraryView === "list"} onClick={() => setLibraryView("list")}>List</button>
          </div>
          <button type="button" className="k-btn k-btn--sm" onClick={() => { setError(null); setFolderModalOpen(true); }}>+ Folder</button>
          <button type="button" className="k-btn k-btn--sm" onClick={openUpload}>+ Upload</button>
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={busy} onClick={() => void updateSettings({ enabled: false })}>Disable</button>
        </div>

        {activeFolder ? (
          <div className="am__folder-tools">
            <span className="k-faint k-truncate">{activeFolder.instruction || "No placement instruction"}</span>
            <span className="k-spacer" />
            <label className="k-check k-faint" title="Prevent agents from uploading here">
              <input type="checkbox" checked={activeFolder.prevent_agent_uploads} disabled={busy} onChange={(event) => void mutate(async () => { await updateAssetCategorySettings(projectId, activeFolder.id, { prevent_agent_uploads: event.target.checked }); })} />
              No agent uploads
            </label>
            <label className="am__color-picker">
              <span className="am__color-swatch" style={{ backgroundColor: folderColorValue(activeFolder.color) }} aria-hidden="true" />
              <span className="k-faint">Color</span>
              <select className="k-select" aria-label="Folder color" value={activeFolder.color} disabled={busy} onChange={(event) => void mutate(() => updateAssetCategorySettings(projectId, activeFolder.id, { color: event.target.value as AssetBucketColor }))}>
                {folderColors.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}
              </select>
            </label>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" aria-pressed={editingFolder} onClick={() => setEditingFolder((v) => !v)}>Metadata</button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={busy} onClick={() => openMove({ kind: "folder", folder: activeFolder })}>Move</button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" disabled={busy} onClick={() => deleteFolder(activeFolder)}>Delete</button>
          </div>
        ) : null}

        <div className="am__explorer">
          {editingFolder && activeFolder ? <MetadataEditor title="folder" value={activeFolder.metadata} busy={busy} onSave={(metadata) => mutate(() => updateAssetCategoryMetadata(projectId, activeFolder.id, metadata))} /> : null}
          {childFolders.length === 0 && folderAssets.length === 0 ? (
            <p className="k-empty">Empty</p>
          ) : libraryView === "grid" ? (
            <>
              {childFolders.length > 0 ? <div className="am__folders">{childFolders.map(folderTile)}</div> : null}
              {folderAssets.length > 0 ? (
                <div className="am__grid">
                  {folderAssets.map((asset) => {
                    const variation = primaryVariation(asset);
                    return (
                      <article key={asset.id} className="am__card">
                        <div className="am__thumb" role="button" tabIndex={0} aria-label={`Open ${asset.name}`} onClick={() => setSelectedAssetId(asset.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedAssetId(asset.id); }}>
                          <AssetPreview projectId={projectId} asset={asset} variation={variation} />
                        </div>
                        <div className="am__card-foot">
                          <button type="button" className="am__card-body" onClick={() => setSelectedAssetId(asset.id)}>
                            <strong className="k-truncate">{asset.name}</strong>
                            <span className="k-faint">{asset.variations.length} var · {asset.variations.filter((item) => item.used).length} used{asset.metadata.tags[0] ? ` · ${asset.metadata.tags[0]}` : ""}</span>
                          </button>
                          <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={busy} title="Move asset" aria-label={`Move ${asset.name}`} onClick={() => openMove({ kind: "asset", asset })}>Move</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <div className="am__list">
              {childFolders.map((folder) => (
                <div key={folder.id} className="am__folder-row">
                  <button type="button" className="am__folder-open" onClick={() => setActiveFolderId(folder.id)}>
                    <FolderIcon color={folder.color} />
                    <strong className="k-truncate">{folder.title}</strong>
                    <span className="k-faint">{folderItemCount(folder.id)} items</span>
                  </button>
                  <span className="k-spacer" />
                  <button type="button" className="k-btn k-btn--sm" disabled={busy} onClick={() => openMove({ kind: "folder", folder })}>Move</button>
                  <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={() => deleteFolder(folder)}>Delete</button>
                </div>
              ))}
              {folderAssets.map((asset) => (
                <article key={asset.id} className="am__asset">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{asset.name}</strong>
                    <span className="k-faint">{asset.variations.length} var · {new Date(asset.updated_at).toLocaleString()}</span>
                    <span className="k-spacer" />
                    <button type="button" className="k-btn k-btn--sm" onClick={() => setSelectedAssetId(asset.id)}>Open</button>
                    <button type="button" className="k-btn k-btn--sm" disabled={busy} onClick={() => openMove({ kind: "asset", asset })}>Move</button>
                    <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={() => deleteAsset(asset)}>Delete</button>
                  </div>
                  <MetadataEditor title="metadata" value={asset.metadata} busy={busy} onSave={(metadata) => mutate(() => updateAssetMetadata(projectId, asset.id, metadata))} />
                  <div>
                    {asset.variations.length === 0 ? <p className="k-empty">No variations</p> : asset.variations.map((variation) => (
                      <div key={variation.id} className="am__variation">
                        <div className="k-truncate">
                          <strong>{variation.name}</strong>
                          <span className="k-faint" style={{ marginLeft: 8 }}>{variation.file_name} · {formatBytes(variation.size_bytes)} · {variation.created_by} · {variation.approval}</span>
                        </div>
                        <label className="k-check"><input type="checkbox" checked={variation.used} disabled={busy} onChange={(event) => void mutate(() => setAssetVariationUsage(projectId, asset.id, variation.id, event.target.checked))} />Used</label>
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" disabled={busy} onClick={() => window.confirm(`Delete variation "${variation.name}"?`) && void mutate(() => deleteAssetVariationRequest(projectId, asset.id, variation.id))}>Delete</button>
                      </div>
                    ))}
                  </div>
                  <VariationUploader asset={asset} busy={busy} onUpload={(assetId, file, name, used) => mutate(async () => { await uploadAssetVariation(projectId, assetId, { file_name: file.name, media_type: file.type, content_base64: await fileToBase64(file), variation_name: name || file.name, used }); })} />
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <button type="button" className="k-btn k-btn--primary am__fab" aria-label="Upload asset" title="Upload asset" onClick={openUpload}>+</button>

      {folderModalOpen ? (
        <FormDialog title="New folder" onClose={() => setFolderModalOpen(false)}>
          <span className="k-faint">In {["Assets", ...trail.map((folder) => folder.title)].join(" › ")}</span>
          <div className="k-field"><label className="k-label">Name</label><input className="k-input" value={folderTitle} onChange={(event) => setFolderTitle(event.target.value)} placeholder="Characters" autoFocus /></div>
          <div className="k-field"><label className="k-label">Placement instruction</label><textarea className="k-textarea" style={{ minHeight: 64 }} value={folderInstruction} onChange={(event) => setFolderInstruction(event.target.value)} /></div>
          <label className="k-check"><input type="checkbox" checked={folderPreventAgentUploads} onChange={(event) => setFolderPreventAgentUploads(event.target.checked)} />No agent uploads</label>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="k-btn" onClick={() => setFolderModalOpen(false)}>Cancel</button>
            <button type="button" className="k-btn k-btn--primary" disabled={busy || !folderTitle.trim()} onClick={() => void createFolder()}>Create</button>
          </div>
        </FormDialog>
      ) : null}

      {uploadModalOpen ? (
        <FormDialog title="Upload asset" onClose={() => setUploadModalOpen(false)}>
          <div className="k-field-grid">
            <div className="k-field">
              <label className="k-label">Folder</label>
              <FolderSelect value={assetFolder} options={allOptions} includeRoot invalid={uploadAttempted && !assetFolder} onChange={setAssetFolder} />
            </div>
            <div className="k-field">
              <label className="k-label">Name</label>
              <input className="k-input" style={uploadAttempted && !assetName.trim() ? { borderColor: "var(--danger)" } : undefined} value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Checkout hero" autoFocus />
            </div>
          </div>
          <div className="k-field">
            <label className="k-label">Files</label>
            <input ref={assetFileInput} className="k-input" style={uploadAttempted && assetFiles.length === 0 ? { borderColor: "var(--danger)" } : undefined} type="file" multiple onChange={(event) => setAssetFiles(Array.from(event.target.files ?? []))} />
            <span className="k-faint">Files become variations</span>
          </div>
          <label className="k-check"><input type="checkbox" checked={assetUsed} onChange={(event) => setAssetUsed(event.target.checked)} />Mark as used</label>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="k-btn" onClick={() => setUploadModalOpen(false)}>Cancel</button>
            <button type="button" className="k-btn k-btn--primary" disabled={busy} onClick={() => void uploadNewAsset()}>Upload</button>
          </div>
        </FormDialog>
      ) : null}

      {moveTarget ? (
        <FormDialog title={moveTarget.kind === "asset" ? `Move "${moveTarget.asset.name}"` : `Move "${moveTarget.folder.title}"`} onClose={() => setMoveTarget(null)}>
          <div className="k-field">
            <label className="k-label">Destination</label>
            <FolderSelect value={moveDestination} options={moveOptions} includeRoot onChange={setMoveDestination} autoFocus />
          </div>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="k-btn" onClick={() => setMoveTarget(null)}>Cancel</button>
            <button type="button" className="k-btn k-btn--primary" disabled={busy} onClick={() => void submitMove()}>Move</button>
          </div>
        </FormDialog>
      ) : null}

      {selectedAsset ? (
        <AssetDetailDialog
          projectId={projectId}
          asset={selectedAsset}
          busy={busy}
          onClose={() => setSelectedAssetId(null)}
          onSetUsed={(variationId, used) => void mutate(() => setAssetVariationUsage(projectId, selectedAsset.id, variationId, used))}
          onDeleteVariation={(variation) => { if (window.confirm(`Delete variation "${variation.name}"?`)) void mutate(() => deleteAssetVariationRequest(projectId, selectedAsset.id, variation.id)); }}
          onDeleteAsset={() => { if (window.confirm(`Delete "${selectedAsset.name}" and all variations?`)) void mutate(() => deleteManagedAssetRequest(projectId, selectedAsset.id)); }}
        />
      ) : null}
    </div>
  );
}
