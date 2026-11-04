import { useEffect, useRef, useState } from 'react';
import {
  Battery,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Camera,
  Cpu,
  Loader2,
  Play,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Terminal,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, getAdminKey, mockTrapUrl, setAdminKey } from '../api.js';
import { EASE, Item, Stagger } from '../lib/motion.jsx';
import { LOW_BATTERY, RISK_STYLES, timeAgo, totalOf } from '../lib/pests.js';
import Badge from './Badge.jsx';
import DecisionBadge from './DecisionBadge.jsx';
import TelegramCard from './TelegramCard.jsx';
import PhotoBotCard from './PhotoBotCard.jsx';
import HardwareControls from './HardwareControls.jsx';
import { SystemStatusCard } from './SystemStatus.jsx';

let logSeq = 0;

/** Turns API errors into operator-friendly messages. */
const explain = (err) =>
  err.status === 401
    ? 'Admin key required - enter it above.'
    : err.status === 403
      ? 'Admin key rejected - check ADMIN_API_KEY.'
      : err.message;

/** Admin & hardware control: battery override + in-browser edge capture simulator. */
export default function AdminPanel({ devices, activeDeviceId, health, adminAuthRequired, onDevicePatched, onIngested }) {
  const [log, setLog] = useState([]);
  const pushLog = (msg, level = 'info') =>
    setLog((l) => [{ id: ++logSeq, at: new Date(), msg, level }, ...l].slice(0, 40));

  const active = devices.find((d) => d.id === activeDeviceId) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span className="pill-label w-fit">Admin & hardware</span>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Control the trap box</h1>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          Switch the fan and trap light, send commands to the Raspberry Pi, set battery levels, test captures and manage
          Telegram alerts. Changes need the admin key.
        </p>
      </header>
    <Stagger className="grid gap-6 lg:grid-cols-5" stagger={0.08}>
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
        <Item>
          <AdminKeyBox required={adminAuthRequired} />
        </Item>
        <Item>
          <HardwareControls device={active} log={pushLog} />
        </Item>
        <Item as="section" className="card">
          <h2 className="card-title mb-1">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Cpu className="h-4 w-4" />
            </span>
            Battery
          </h2>
          <p className="mb-5 text-sm text-slate-500">
            Manually override each trap's battery level (no battery sensor is wired yet). Values are saved as{' '}
            <i>manual</i> with a timestamp; dropping below {LOW_BATTERY}% raises live alerts across the dashboard.
          </p>
          <div className="flex flex-col gap-4">
            {devices.length === 0 && <p className="text-sm text-slate-500">No devices registered.</p>}
            {devices.map((d) => (
              <BatteryControl key={d.id} device={d} onPatched={onDevicePatched} log={pushLog} />
            ))}
          </div>
        </Item>

        <Item>
          <CaptureSimulator deviceId={activeDeviceId} onIngested={onIngested} log={pushLog} />
        </Item>
        <Item>
          <TelegramCard log={pushLog} />
        </Item>
        <Item>
          <PhotoBotCard log={pushLog} />
        </Item>
        <Item>
          <DemoControl onChanged={onIngested} log={pushLog} />
        </Item>
      </div>

      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
      <Item>
        <SystemStatusCard health={health} />
      </Item>
      <Item as="section" className="card flex flex-col lg:sticky lg:top-24">
        <h2 className="card-title mb-3">
          <span className="icon-chip h-8! w-8! rounded-lg!">
            <Terminal className="h-4 w-4" />
          </span>
          Event Log
          <span className="ml-auto text-[11px] font-normal text-slate-500">{log.length} events</span>
        </h2>
        <ul className="flex max-h-[640px] flex-col gap-1 overflow-y-auto rounded-xl bg-canvas p-3 font-mono text-xs ring-1 ring-slate-200">
          {log.length === 0 && <li className="text-slate-500">Actions you take here will be logged.</li>}
          <AnimatePresence initial={false}>
            {log.map((e) => (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: -8, backgroundColor: 'rgba(21,128,61,0.10)' }}
                animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(21,128,61,0)' }}
                transition={{ duration: 0.45, ease: EASE }}
                className={`rounded-md px-1.5 py-0.5 ${
                  e.level === 'error' ? 'text-rose-700' : e.level === 'warn' ? 'text-amber-800' : 'text-slate-700'
                }`}
              >
                <span className="text-slate-500">{e.at.toLocaleTimeString()}</span> {e.msg}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Item>
      </div>
    </Stagger>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Demo mode: one click re-seeds 4 DEMO traps with 14 days of simulated captures (or removes them). */
function DemoControl({ onChanged, log }) {
  const [busy, setBusy] = useState(null); // 'reset' | 'clear' | null
  const [result, setResult] = useState(null);

  const run = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'reset') {
        const r = await api.resetDemo();
        setResult(r);
        log(`Demo reset: ${r.captures} simulated captures across ${r.traps.length} DEMO traps (${r.days} days)`);
      } else {
        const r = await api.clearDemo();
        setResult(null);
        log(`Demo cleared: removed ${r.removed} DEMO trap(s)`, 'warn');
      }
      await onChanged?.();
    } catch (err) {
      log(`Demo ${kind} failed: ${explain(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" data-testid="demo-control">
      <h2 className="card-title mb-1">
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <Sparkles className="h-4 w-4" />
        </span>
        Demo mode
        <Badge tone="warn" className="ml-auto">
          Simulated data
        </Badge>
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Loads four <b>DEMO</b> traps with 14 days of simulated whitefly and predator captures (demo detector + rule engine,
        no paid API calls). They are built to show every decision: SPRAY, RELEASE BIOCONTROL, a BORDERLINE WAIT and CHECK
        TRAP. Reset any time to start the story again from today.
      </p>
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={() => run('reset')} disabled={busy !== null}>
          {busy === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {busy === 'reset' ? 'Seeding…' : 'Reset demo data'}
        </button>
        <button className="btn btn-ghost" onClick={() => run('clear')} disabled={busy !== null}>
          {busy === 'clear' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Remove demo traps
        </button>
      </div>
      {result && (
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {result.traps.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-800">{t.name}</span>
              <DecisionBadge decision={t.decision} borderline={t.borderline} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Operator enters the admin key at runtime; it is kept in sessionStorage, never in the build. */
function AdminKeyBox({ required }) {
  const [value, setValue] = useState(getAdminKey);
  const [saved, setSaved] = useState(Boolean(getAdminKey()));
  if (!required && !saved) {
    return (
      <p className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-800">
        Demo mode: admin actions are not protected by a key on this backend.
      </p>
    );
  }
  return (
    <form
      className="card flex flex-wrap items-center gap-3 p-4!"
      onSubmit={(e) => {
        e.preventDefault();
        setAdminKey(value.trim());
        setSaved(Boolean(value.trim()));
      }}
    >
      <label htmlFor="admin-key" className="text-sm text-slate-700">
        Admin key
      </label>
      <input
        id="admin-key"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="field min-w-0 flex-1 px-3 py-1.5 text-sm"
        placeholder="ADMIN_API_KEY"
      />
      <button className="btn btn-primary py-1.5">Save</button>
      {saved ? <Badge tone="good">Key set for this tab</Badge> : <Badge tone="bad">Required</Badge>}
    </form>
  );
}

const BATTERY_SOURCE = {
  manual: { tone: 'warn', label: 'Manual override' },
  device: { tone: 'good', label: 'Reported by device' },
  unknown: { tone: 'muted', label: 'Not reported' },
};

function batteryVisual(level) {
  if (level < LOW_BATTERY) return { Icon: BatteryWarning, color: '#f43f5e', text: 'text-rose-700' };
  if (level < 40) return { Icon: BatteryLow, color: '#f59e0b', text: 'text-amber-800' };
  if (level < 75) return { Icon: BatteryMedium, color: '#a3e635', text: 'text-lime-700' };
  return { Icon: BatteryFull, color: '#10b981', text: 'text-emerald-700' };
}

const STATUS_BADGE = {
  online: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40',
  low_battery: 'bg-rose-500/15 text-rose-700 ring-rose-500/40',
  offline: 'bg-slate-200 text-slate-500 ring-slate-300',
};

function BatteryControl({ device, onPatched, log }) {
  const [value, setValue] = useState(device.battery_level);
  const [saving, setSaving] = useState(false);
  const dragging = useRef(false);
  const timer = useRef();

  // Follow server updates unless the user is mid-drag
  useEffect(() => {
    if (!dragging.current) setValue(device.battery_level);
  }, [device.battery_level]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Debounced PATCH so dragging the slider doesn't flood the API. */
  const commit = (raw) => {
    const level = Math.min(100, Math.max(0, Math.round(Number(raw) || 0)));
    setValue(level);
    onPatched({ id: device.id, battery_level: level }); // optimistic
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const { device: saved, alert } = await api.setBattery(device.id, level);
        onPatched(saved);
        log(`${saved.name}: battery manually set to ${saved.battery_level}% (${saved.status})`, alert ? 'warn' : 'info');
      } catch (err) {
        log(`Battery update failed: ${explain(err)}`, 'error');
        onPatched({ id: device.id, battery_level: device.battery_level }); // roll back the optimistic value
      } finally {
        setSaving(false);
        dragging.current = false;
      }
    }, 250);
  };

  const { Icon, color, text } = batteryVisual(value);
  const low = value < LOW_BATTERY;

  return (
    <div
      className={`rounded-2xl border p-4 transition-all duration-500 ${
        low
          ? 'border-rose-500/60 bg-rose-500/5 shadow-[0_0_28px_-6px_rgba(244,63,94,0.55)]'
          : 'border-slate-200 bg-slate-50 hover:border-emerald-500/30'
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Icon className={`h-7 w-7 transition-colors duration-500 ${text} ${low ? 'animate-pulse' : ''}`} />
        <div className="min-w-0">
          <div className="truncate font-medium">{device.name}</div>
          <div className="font-mono text-[11px] text-slate-500">{device.id}</div>
        </div>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Badge tone={(BATTERY_SOURCE[device.battery_source] ?? BATTERY_SOURCE.unknown).tone}>
            {(BATTERY_SOURCE[device.battery_source] ?? BATTERY_SOURCE.unknown).label}
            {device.battery_updated_at ? ` · ${timeAgo(device.battery_updated_at)}` : ''}
          </Badge>
          <span
            data-testid="device-status"
            className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${STATUS_BADGE[device.status] ?? STATUS_BADGE.offline}`}
          >
            {device.status?.replace('_', ' ')}
          </span>
        </span>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      </div>

      {/* Animated level gauge */}
      <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 14px ${color}66` }}
          initial={false}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.5, ease: EASE }}
        />
      </div>

      <div className="flex items-center gap-4">
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          className="battery h-2 flex-1 cursor-pointer"
          style={{ '--battery-color': color }}
          onPointerDown={() => (dragging.current = true)}
          onChange={(e) => commit(e.target.value)}
          aria-label={`Battery level for ${device.name}`}
        />
        <div className="field flex items-center pr-2">
          <input
            type="number"
            min="0"
            max="100"
            value={value}
            onChange={(e) => commit(e.target.value)}
            className="w-14 bg-transparent px-2 py-1 text-right tabular-nums focus:outline-none"
          />
          <span className="text-sm text-slate-500">%</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {[100, 50, 14, 5, 0].map((p) => (
          <button
            key={p}
            onClick={() => commit(p)}
            className="btn btn-ghost rounded-lg px-2.5 py-1 text-xs font-medium"
          >
            <Battery className="mr-1 inline h-3 w-3" />
            {p}%
          </button>
        ))}
      </div>

      <AnimatePresence>
        {low && (
          <motion.p
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex items-center gap-2 overflow-hidden text-sm font-medium text-rose-700"
          >
            <BatteryWarning className="h-4 w-4" />
            Critical: battery below {LOW_BATTERY}% - schedule a swap or switch to solar.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CaptureSimulator({ deviceId, onIngested, log }) {
  const [temperature, setTemperature] = useState(26);
  const [humidity, setHumidity] = useState(72);
  const [density, setDensity] = useState(0.4);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [last, setLast] = useState(null);

  const inFlight = useRef(false); // never overlap captures (Claude can take longer than the stream interval)

  const send = async () => {
    if (!deviceId) return log('No device selected', 'error');
    if (inFlight.current) return log('Previous capture still processing - skipped one tick', 'warn');
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await api.ingest({
        device_id: deviceId,
        temperature,
        humidity,
        image_url: mockTrapUrl(density),
      });
      const det = res.telemetry.detection;
      setLast(det);
      const adv = det.ai_advisory;
      log(
        `Simulated capture #${res.telemetry.id}: ${totalOf(det.pest_counts)} insects → ${adv.risk_level ?? 'no'} risk ` +
          `[vision: ${res.sources.vision}, advisory: ${res.sources.advisory}/${res.sources.advisory_status}]`,
        adv.status === 'fallback' ? 'warn' : 'info'
      );
      onIngested();
    } catch (err) {
      log(`Capture failed: ${explain(err)}`, 'error');
      setStreaming(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // Auto-stream: every 6s, drift the microclimate and correlate pest density with it
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => {
      setTemperature((v) => round1(clampNum(v + (Math.random() - 0.45) * 2, 12, 38)));
      setHumidity((v) => round1(clampNum(v + (Math.random() - 0.45) * 5, 30, 98)));
      setDensity((v) => round2(clampNum(v + (Math.random() - 0.4) * 0.12, 0.05, 1)));
      sendRef.current();
    }, 6000);
    return () => clearInterval(t);
  }, [streaming]);

  return (
    <section className="card overflow-hidden">
      {/* Indeterminate progress while the pipeline (vision -> LLM -> DB) runs */}
      <div className="absolute inset-x-0 top-0">{busy && <div className="progress-indeterminate" />}</div>
      <h2 className="card-title mb-1">
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <Camera className="h-4 w-4" />
        </span>
        Edge Capture Simulator
      </h2>
      <p className="mb-5 text-sm text-slate-500">
        Sends a <b>simulated</b> capture (synthetic trap image + the readings below) through the full pipeline (vision →
        advisory → database) for the selected device. It is stored and shown as simulated data.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Slider label="Temperature" unit="°C" min={-5} max={45} step={0.5} value={temperature} onChange={setTemperature} />
        <Slider label="Humidity" unit="%" min={0} max={100} step={1} value={humidity} onChange={setHumidity} />
        <Slider label="Pest pressure" unit="" min={0} max={1} step={0.05} value={density} onChange={setDensity} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={send}
          disabled={busy || !deviceId}
          className="btn btn-primary"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Capture now
        </button>
        <button
          onClick={() => setStreaming((s) => !s)}
          disabled={!deviceId}
          className={`btn ${streaming ? 'bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/50 hover:bg-rose-500/25' : 'btn-ghost'}`}
        >
          {streaming ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {streaming ? 'Stop stream' : 'Auto-stream (6s)'}
        </button>
        <AnimatePresence>
          {streaming && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              className="flex items-center gap-1.5 text-xs text-emerald-700"
            >
              <Radio className="h-3.5 w-3.5 animate-pulse" /> streaming
            </motion.span>
          )}
        </AnimatePresence>
        {busy && <span className="text-xs text-slate-500">Running vision + advisory…</span>}
        <AnimatePresence mode="popLayout">
          {last && (
            <motion.span
              key={`${totalOf(last.pest_counts)}-${last.ai_advisory.generated_at}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3, ease: EASE }}
              className={`ml-auto rounded-full px-3 py-1 text-xs ring-1 ring-black/5 ${RISK_STYLES[last.ai_advisory.risk_level]?.bg ?? 'bg-slate-100'} ${
                RISK_STYLES[last.ai_advisory.risk_level]?.text ?? 'text-slate-700'
              }`}
            >
              Last: {totalOf(last.pest_counts)} insects · {last.ai_advisory.risk_level ?? 'no advisory'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function Slider({ label, unit, min, max, step, value, onChange }) {
  return (
    <label className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200 transition-colors duration-200 hover:ring-emerald-500/30">
      <span className="flex justify-between text-slate-500">
        {label}
        <motion.span
          key={value}
          initial={{ scale: 1.25, color: '#6ee7b7' }}
          animate={{ scale: 1, color: '#0f172a' }}
          transition={{ duration: 0.35, ease: EASE }}
          className="inline-block tabular-nums"
        >
          {value}
          {unit}
        </motion.span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-emerald-500"
      />
    </label>
  );
}

const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
