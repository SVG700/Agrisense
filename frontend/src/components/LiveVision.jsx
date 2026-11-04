import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Aperture, Camera, Cpu, Gauge, Layers, Play, Radio, ScanLine, Square, X } from 'lucide-react';
import { api, getAdminKey } from '../api.js';
import { pestMeta, timeAgo } from '../lib/pests.js';
import { haptic } from '../lib/theme.js';

const POLL_MS = 1000;
const SPRING = { type: 'spring', stiffness: 210, damping: 30, mass: 1 };

// When the Pi is not streaming, the last capture is shown through these preview
// filters (clearly labelled) so the pipeline can still be explained.
const PREVIEW_STAGES = [
  { name: 'Raw', filter: 'none' },
  { name: 'Grayscale', filter: 'grayscale(1) contrast(1.15)' },
  { name: 'Threshold', filter: 'grayscale(1) contrast(7) brightness(1.15)' },
  { name: 'Detections', filter: 'none', boxes: true },
];
const DEFAULT_PIPELINE = ['Picamera2 capture', 'Lens undistort', 'HSV yellow-card mask', 'Adaptive threshold', 'Contours → insect blobs', 'Roboflow model (counts)'];

/**
 * Live Vision: the Raspberry Pi's OpenCV view of the trap. Opens with a liquid
 * reveal from where it was pressed (`origin`), and the trap photo morphs into
 * the viewer (shared layoutId). Polls GET /api/devices/:id/vision/frame.
 */
export default function LiveVision({ open, onClose, device, capture, origin, layoutId }) {
  const reduce = useReducedMotion();
  const [data, setData] = useState(null); // {frame, streaming, age_ms}
  const [stage, setStage] = useState(0);
  const [note, setNote] = useState(null);
  const panel = useRef(null);

  const load = useCallback(async () => {
    if (!device?.id) return;
    try {
      setData(await api.visionFrame(device.id));
    } catch {
      setData((d) => d ?? { frame: null, streaming: false });
    }
  }, [device?.id]);

  useEffect(() => {
    if (!open) return undefined;
    setStage(0);
    setNote(null);
    load();
    const t = setInterval(load, POLL_MS);
    const prev = document.activeElement;
    panel.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      clearInterval(t);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, load]);

  const live = Boolean(data?.streaming && data.frame);
  const frame = live ? data.frame : null;
  const stages = useMemo(
    () => (frame ? [{ name: 'Raw', image: frame.image }, ...frame.stages, { name: 'Detections', image: frame.image, boxes: true }] : PREVIEW_STAGES),
    [frame]
  );
  const current = stages[Math.min(stage, stages.length - 1)];
  const boxes = (frame ? frame.boxes : capture?.detection?.bounding_boxes) ?? [];
  const image = frame ? current.image : capture?.image_url;
  const pipeline = frame?.pipeline?.length ? frame.pipeline : DEFAULT_PIPELINE;

  const send = async (command, label) => {
    haptic();
    if (!getAdminKey()) {
      setNote('Enter the admin key on the Hardware page to control the Pi.');
      return;
    }
    try {
      await api.sendCommand(device.id, command);
      setNote(`${label} sent - the Pi runs it on its next check-in.`);
    } catch (err) {
      setNote(err.message);
    }
  };

  // Keyboard: Esc closes, 1-4 picks a stage
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      const n = Number(e.key);
      if (n >= 1 && n <= stages.length) setStage(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, stages.length]);

  const ox = origin?.x ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 0);
  const oy = origin?.y ?? (typeof window !== 'undefined' ? window.innerHeight / 2 : 0);

  // Portal: the app window uses backdrop-filter, which would trap a fixed overlay inside it
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="live-vision"
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Live Vision - ${device?.name ?? 'trap'}`}
          className="fixed inset-0 z-[85] overflow-y-auto bg-[#0b0a08] text-[#f4efe8] outline-none"
          // Liquid reveal: a circle of "ink" grows from the press point
          initial={reduce ? { opacity: 0 } : { clipPath: `circle(0px at ${ox}px ${oy}px)` }}
          animate={reduce ? { opacity: 1 } : { clipPath: `circle(150vmax at ${ox}px ${oy}px)` }}
          exit={reduce ? { opacity: 0 } : { clipPath: `circle(0px at ${ox}px ${oy}px)`, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } }}
          transition={reduce ? { duration: 0.15 } : { duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
          drag={reduce ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.35 }}
          onDragEnd={(_, info) => (info.offset.y > 140 || info.velocity.y > 700) && onClose()}
        >
          <FluidBlobs />

          <div className="relative mx-auto flex min-h-full max-w-[1320px] flex-col gap-5 px-4 py-5 sm:px-8 sm:py-7">
            {/* header */}
            <motion.header
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: 0.25 } }}
              className="flex flex-wrap items-center gap-3"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f6d867] text-[#2b231c]">
                <Aperture className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight">Live Vision</h2>
                <p className="text-xs text-[#f4efe8]/60">{device?.name ?? '—'} · Raspberry Pi OpenCV</p>
              </div>
              <span
                className={`ml-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${
                  live ? 'bg-[#22c55e]/15 text-[#86efac] ring-[#22c55e]/40' : 'bg-[#f6d867]/10 text-[#f6d867] ring-[#f6d867]/30'
                }`}
                role="status"
              >
                {live ? <span className="live-dot text-[#4ade80]" aria-hidden="true" /> : <Radio className="h-3.5 w-3.5" aria-hidden="true" />}
                {live ? `Streaming${frame.fps ? ` · ${frame.fps.toFixed(0)} fps` : ''}` : 'Pi not streaming - preview of the last capture'}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto grid h-11 w-11 place-items-center rounded-full bg-[#fff]/10 ring-1 ring-[#fff]/15 transition-colors hover:bg-[#fff]/20"
                aria-label="Close Live Vision (Esc)"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </motion.header>

            <div className="grid flex-1 gap-5 lg:grid-cols-[1fr_320px]">
              {/* viewer */}
              <div className="flex min-w-0 flex-col gap-3">
                <div role="tablist" aria-label="Processing stage" className="flex flex-wrap gap-1.5 rounded-full bg-[#fff]/[0.06] p-1 ring-1 ring-[#fff]/10 sm:w-fit">
                  {stages.map((s, i) => (
                    <button
                      key={s.name}
                      role="tab"
                      aria-selected={i === stage}
                      onClick={() => (haptic(), setStage(i))}
                      className={`relative min-h-10 rounded-full px-4 text-sm font-medium transition-colors ${i === stage ? 'text-[#2b231c]' : 'text-[#f4efe8]/70 hover:text-[#f4efe8]'}`}
                    >
                      {i === stage && <motion.span layoutId="lv-stage" className="absolute inset-0 rounded-full bg-[#f6d867]" transition={SPRING} />}
                      <span className="relative">
                        <span className="mr-1.5 text-[10px] opacity-60">{i + 1}</span>
                        {s.name}
                      </span>
                    </button>
                  ))}
                </div>

                <motion.div
                  layoutId={layoutId}
                  transition={SPRING}
                  className="relative aspect-[4/3] w-full overflow-hidden rounded-[28px] bg-[#16130f] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] ring-1 ring-[#fff]/10"
                >
                  {image ? (
                    <img
                      src={image}
                      alt={`Trap ${frame ? 'live frame' : 'photo'} - ${current.name}`}
                      className="absolute inset-0 h-full w-full object-cover transition-[filter] duration-500"
                      style={{ filter: frame ? 'none' : current.filter }}
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-[#f4efe8]/60">No trap image yet.</div>
                  )}
                  {current.boxes && <Boxes boxes={boxes} />}
                  <span className="scan-sweep" aria-hidden="true" />
                  <Corners />
                  {!frame && (
                    <span className="absolute bottom-3 left-3 rounded-full bg-[#000]/55 px-3 py-1 text-[11px] text-[#f4efe8]/85 backdrop-blur">
                      Preview filter on the last capture{capture ? ` (${timeAgo(capture.timestamp)})` : ''} - not a live frame
                    </span>
                  )}
                </motion.div>
              </div>

              {/* side panel */}
              <motion.aside
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0, transition: { ...SPRING, delay: 0.32 } }}
                className="flex flex-col gap-4"
              >
                <section className="rounded-[24px] bg-[#fff]/[0.05] p-5 ring-1 ring-[#fff]/10">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Gauge className="h-4 w-4 text-[#f6d867]" aria-hidden="true" /> Stream
                  </h3>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Frame rate" value={frame?.fps ? `${frame.fps.toFixed(1)} fps` : '—'} />
                    <Stat label="Frame age" value={data?.age_ms != null ? `${(data.age_ms / 1000).toFixed(1)} s` : '—'} />
                    <Stat label="Resolution" value={frame?.width ? `${frame.width}×${frame.height}` : '—'} />
                    <Stat label="Objects" value={String(boxes.length)} />
                  </dl>
                </section>

                <section className="rounded-[24px] bg-[#fff]/[0.05] p-5 ring-1 ring-[#fff]/10">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Layers className="h-4 w-4 text-[#f6d867]" aria-hidden="true" /> OpenCV pipeline
                  </h3>
                  <ol className="flex flex-col gap-2">
                    {pipeline.map((p, i) => (
                      <motion.li
                        key={p}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0, transition: { ...SPRING, delay: 0.4 + i * 0.05 } }}
                        className="flex items-center gap-3 text-sm text-[#f4efe8]/80"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#f6d867]/15 text-[11px] font-semibold text-[#f6d867]">{i + 1}</span>
                        {p}
                      </motion.li>
                    ))}
                  </ol>
                  {!frame && <p className="mt-3 text-[11px] leading-snug text-[#f4efe8]/50">Planned Pi pipeline. The Pi will send its real steps with each frame.</p>}
                </section>

                <section className="rounded-[24px] bg-[#fff]/[0.05] p-5 ring-1 ring-[#fff]/10">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Cpu className="h-4 w-4 text-[#f6d867]" aria-hidden="true" /> Raspberry Pi
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <PiButton icon={live ? Square : Play} onClick={() => send(live ? 'stop_stream' : 'start_stream', live ? 'Stop stream' : 'Start stream')}>
                      {live ? 'Stop stream' : 'Start stream'}
                    </PiButton>
                    <PiButton icon={Camera} onClick={() => send('capture_now', 'Capture now')}>
                      Capture now
                    </PiButton>
                  </div>
                  {note && (
                    <p role="status" className="mt-3 text-xs text-[#f4efe8]/70">
                      {note}
                    </p>
                  )}
                </section>
                <p className="flex items-center gap-2 text-[11px] text-[#f4efe8]/45">
                  <ScanLine className="h-3.5 w-3.5" aria-hidden="true" /> Keys 1-{stages.length} switch stages · Esc or swipe down to close
                </p>
              </motion.aside>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-[#f4efe8]/50">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function PiButton({ icon: Icon, onClick, children }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="liquid inline-flex min-h-11 items-center gap-2 rounded-full bg-[#fff]/10 px-4 text-sm font-medium ring-1 ring-[#fff]/15 [--liquid:#f6d867] hover:text-[#2b231c]"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </motion.button>
  );
}

/** Detection boxes drawn on the frame (relative coordinates). */
function Boxes({ boxes }) {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      {boxes.map((b, i) => {
        const color = pestMeta(b.label).color;
        return (
          <rect
            key={i}
            className="bbox"
            style={{ animationDelay: `${i * 12}ms` }}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            fill={`${color}22`}
            stroke={color}
            strokeWidth="0.004"
            rx="0.004"
          />
        );
      })}
    </svg>
  );
}

function Corners() {
  const c = 'bracket text-[#fff]/80';
  return (
    <span aria-hidden="true">
      <span className={`${c} left-4 top-4 border-l-2 border-t-2 rounded-tl-lg`} />
      <span className={`${c} right-4 top-4 border-r-2 border-t-2 rounded-tr-lg`} />
      <span className={`${c} bottom-4 left-4 border-b-2 border-l-2 rounded-bl-lg`} />
      <span className={`${c} bottom-4 right-4 border-b-2 border-r-2 rounded-br-lg`} />
    </span>
  );
}

/** Slow "liquid" blobs (SVG goo filter) behind the viewer. */
function FluidBlobs() {
  const reduce = useReducedMotion();
  const blobs = [
    { cx: 18, cy: 22, r: 16, dx: 10, dy: 8, c: '#f6d867' },
    { cx: 80, cy: 30, r: 13, dx: -8, dy: 10, c: '#c9a227' },
    { cx: 60, cy: 84, r: 18, dx: 6, dy: -8, c: '#7c5e1c' },
  ];
  return (
    <svg className="pointer-events-none fixed inset-0 h-full w-full opacity-25" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="lv-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
        </filter>
      </defs>
      <g filter="url(#lv-goo)">
        {blobs.map((b, i) => (
          <motion.circle
            key={i}
            cx={b.cx}
            cy={b.cy}
            r={b.r}
            fill={b.c}
            animate={reduce ? undefined : { cx: [b.cx, b.cx + b.dx, b.cx], cy: [b.cy, b.cy + b.dy, b.cy] }}
            transition={{ duration: 14 + i * 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </g>
    </svg>
  );
}
