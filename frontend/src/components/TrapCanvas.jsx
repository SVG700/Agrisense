import { useMemo, useState } from 'react';
import { Crosshair, ImageOff, Loader2, ScanSearch } from 'lucide-react';
import { PESTS, VISION_STATES, pestMeta, visionStatus } from '../lib/pests.js';
import Badge from './Badge.jsx';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** storage path -> {url, at}. Signed URLs live 1 h by default (SUPABASE_SIGNED_URL_TTL); reuse for 45 min. */
const signedUrlCache = new Map();
const SIGNED_URL_REUSE_MS = 45 * 60 * 1000;

/**
 * Keeps only boxes with finite coordinates, clipped to the image frame.
 * Exported for tests.
 */
export function sanitizeBoxes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((b, i) => {
    const vals = [b?.x, b?.y, b?.width, b?.height, b?.confidence].map(Number);
    if (!vals.every(Number.isFinite)) return;
    const x1 = clamp01(vals[0]);
    const y1 = clamp01(vals[1]);
    const x2 = clamp01(vals[0] + vals[2]);
    const y2 = clamp01(vals[1] + vals[3]);
    if (x2 <= x1 || y2 <= y1) return;
    out.push({ id: i, label: String(b.label ?? 'unknown'), confidence: clamp01(vals[4]), x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  });
  return out;
}

/**
 * Sticky-trap image with an SVG overlay of bounding boxes.
 * Boxes are normalized (0..1) to the source image; the frame takes the image's
 * own aspect ratio and the image fills it exactly, so the 0..1 viewBox lines up
 * at any rendered size. Hover to preview, click to pin a box.
 */
export default function TrapCanvas({ capture }) {
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [minConf, setMinConf] = useState(0.5);
  const [badUrl, setBadUrl] = useState(null); // remember which URL failed so a new capture retries
  const [loadedUrl, setLoadedUrl] = useState(null);
  const [natural, setNatural] = useState(null);

  const det = capture?.detection ?? null;
  const status = visionStatus(det);
  const vState = VISION_STATES[status];
  const boxes = useMemo(() => sanitizeBoxes(det?.bounding_boxes), [det]);
  const visible = boxes.filter((b) => b.confidence >= minConf && !hidden.has(b.label));
  const labels = [...new Set([...Object.keys(PESTS), ...boxes.map((b) => b.label)])];
  const active = boxes.find((b) => b.id === (hovered ?? pinned)) ?? null;

  // Private images get a NEW signed URL on every poll. Key the <img> by the stable
  // storage path and reuse the first signed URL for a while, so the picture doesn't
  // remount, flicker and re-download every few seconds.
  const imageKey = capture?.image_path ?? capture?.image_url ?? null;
  let url = capture?.image_url ?? null;
  if (capture?.image_path && url) {
    const hit = signedUrlCache.get(capture.image_path);
    if (hit && Date.now() - hit.at < SIGNED_URL_REUSE_MS && hit.url !== badUrl) url = hit.url;
    else signedUrlCache.set(capture.image_path, { url, at: Date.now() });
  }
  const imgError = Boolean(url) && badUrl === url;
  const loaded = Boolean(imageKey) && loadedUrl === imageKey;
  // Aspect ratio: the actual image once loaded, else the size the model reported, else 4:3
  const metaDims = det?.vision_meta?.image;
  const dims = (loaded && natural) || (metaDims?.width && metaDims?.height ? metaDims : null);
  const aspect = dims ? dims.width / dims.height : 4 / 3;

  const toggle = (label) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">
          <span className="icon-chip h-8! w-8! rounded-lg!">
            <ScanSearch className="h-4 w-4" />
          </span>
          Interactive Trap View
        </h2>
        <div className="flex items-center gap-2">
          {vState && (
            <Badge tone={vState.tone} title={vState.help}>
              {vState.label}
            </Badge>
          )}
          <span className="text-xs text-slate-500" data-testid="box-count">
            {visible.length} / {boxes.length} shown
          </span>
        </div>
      </div>

      {/* Species filter chips */}
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => {
          const meta = pestMeta(label);
          const off = hidden.has(label);
          return (
            <button
              key={label}
              onClick={() => toggle(label)}
              aria-pressed={!off}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 transition-all duration-200 hover:-translate-y-px active:scale-95 ${
                off ? 'text-slate-500 ring-slate-200 hover:text-slate-700' : 'bg-slate-100 text-slate-900 ring-slate-300 hover:ring-emerald-500/50'
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: off ? '#475569' : meta.color }} />
              {meta.name}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          Min confidence
          <input
            type="range"
            min="0"
            max="0.95"
            step="0.05"
            value={minConf}
            onChange={(e) => setMinConf(Number(e.target.value))}
            className="w-24 accent-emerald-500"
          />
          <span className="w-8 tabular-nums text-slate-800">{Math.round(minConf * 100)}%</span>
        </label>
      </div>

      {/* Image + overlay */}
      <div
        className="frame-corners relative w-full overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-emerald-200 transition-[aspect-ratio] duration-500"
        style={{ aspectRatio: aspect }}
        onMouseLeave={() => setHovered(null)}
        data-testid="trap-frame"
      >
        {!capture ? (
          <Empty text="No captures yet. Send one from the Admin tab or run the edge simulator." />
        ) : !url ? (
          <Empty text={vState?.help ?? 'This capture has no image.'} />
        ) : imgError ? (
          <Empty text="Trap image could not be loaded (it may have expired - refresh to get a new link)." />
        ) : (
          <>
            {!loaded && (
              <div className="skeleton absolute inset-0 grid place-items-center rounded-none! text-slate-500">
                <span className="relative z-10 flex items-center gap-2 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading trap image…
                </span>
              </div>
            )}
            <img
              key={imageKey}
              src={url}
              alt="Sticky trap"
              className={`absolute inset-0 h-full w-full select-none object-fill ${loaded ? 'img-reveal opacity-100' : 'opacity-0'}`}
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
                setNatural(width && height ? { width, height } : null);
                setLoadedUrl(imageKey);
              }}
              onError={() => {
                // e.g. an expired signed URL: forget it so the next poll's fresh URL is used
                if (capture?.image_path) signedUrlCache.delete(capture.image_path);
                setBadUrl(url);
              }}
            />
            {/* One scanning sweep per capture; boxes appear as the beam passes them */}
            {loaded && <div key={`scan-${capture.id}`} className="scan-beam" />}
            {loaded && (
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                {visible.map((b) => {
                  const { color } = pestMeta(b.label);
                  const isActive = active?.id === b.id;
                  return (
                    <rect
                      key={`${capture.id}-${b.id}`}
                      data-testid="bbox"
                      data-label={b.label}
                      x={b.x}
                      y={b.y}
                      width={b.width}
                      height={b.height}
                      fill={isActive ? `${color}55` : `${color}14`}
                      stroke={color}
                      strokeWidth={isActive ? 3 : 1.5}
                      vectorEffect="non-scaling-stroke"
                      className={`bbox cursor-pointer ${isActive ? 'bbox-active' : ''}`}
                      style={{ animationDelay: isActive ? undefined : `${Math.round(150 + b.y * 1050)}ms` }}
                      onMouseEnter={() => setHovered(b.id)}
                      onClick={() => setPinned((p) => (p === b.id ? null : b.id))}
                    />
                  );
                })}
              </svg>
            )}
            {loaded && active && <Tooltip box={active} pinned={pinned === active.id} />}
            {loaded && ['failed', 'not_configured'].includes(status) && (
              <div className="overlay-in absolute inset-x-0 bottom-0 bg-white/95 px-3 py-2 text-xs text-amber-800 backdrop-blur">
                {vState.help}
                {det?.vision_meta?.error?.code ? ` (${det.vision_meta.error.code})` : ''}
              </div>
            )}
            {loaded && status === 'ok' && boxes.length === 0 && (
              <div className="overlay-in absolute inset-x-0 bottom-0 bg-white/95 px-3 py-2 text-xs text-slate-800 backdrop-blur">
                The model found no insects on this trap.
              </div>
            )}
          </>
        )}
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <Crosshair className="h-3.5 w-3.5" /> Hover a box to inspect it, click to pin.
        {det?.vision_meta?.model && <span className="ml-auto">Model: {det.vision_meta.model}</span>}
      </p>
    </section>
  );
}

function Tooltip({ box, pinned }) {
  const meta = pestMeta(box.label);
  // Keep the tooltip inside the frame: flip left/up near the edges
  const left = box.x + box.width / 2 > 0.7;
  const up = box.y > 0.7;
  const style = {
    [left ? 'right' : 'left']: `${(left ? 1 - box.x : box.x + box.width) * 100}%`,
    [up ? 'bottom' : 'top']: `${(up ? 1 - box.y - box.height : box.y) * 100}%`,
  };
  return (
    <div
      role="tooltip"
      className="tooltip-in pointer-events-none absolute z-10 mx-2 min-w-36 rounded-xl border border-emerald-500/25 bg-white/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur"
      style={style}
    >
      <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: meta.color }}>
        <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
        {meta.name}
        {pinned && <span className="ml-auto text-[10px] text-slate-500">pinned</span>}
      </div>
      <div className="flex justify-between gap-4 text-slate-700">
        <span>Confidence</span>
        <span className="font-mono">{(box.confidence * 100).toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded" style={{ width: `${box.confidence * 100}%`, background: meta.color }} />
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-500">
      <div className="flex flex-col items-center gap-2">
        <ImageOff className="h-8 w-8" />
        {text}
      </div>
    </div>
  );
}
