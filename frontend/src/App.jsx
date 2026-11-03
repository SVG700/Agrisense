import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion';
import {
  BrainCircuit,
  Bug,
  Camera,
  Cpu,
  Database,
  LineChart,
  Map as MapIcon,
  RefreshCw,
  Sprout,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { api } from './api.js';
import { LOW_BATTERY } from './lib/pests.js';
import { EASE, WordReveal, pageTransition } from './lib/motion.jsx';
import { LanguageContext, LanguageToggle } from './lib/i18n.jsx';
import { BackToTop, InteractionEffects, ScrollProgress } from './components/InteractionEffects.jsx';
import FarmerDashboard from './components/FarmerDashboard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import PhoneCheckPage from './components/PhoneCheckPage.jsx';
import AmbientBackground from './components/AmbientBackground.jsx';
import { DashboardSkeleton } from './components/Skeletons.jsx';

// The map page (and everything kepler.gl pulls in) is a separate chunk, loaded on first visit
const PestMapPage = lazy(() => import('./map/PestMapPage.jsx'));

const LANG_KEY = 'agrisense.lang';
// EN / Kannada applies to the farmer-facing pages only; the map and admin pages stay English
const TRANSLATED_TABS = ['farmer', 'check'];
const storedLang = () => {
  try {
    return localStorage.getItem(LANG_KEY) === 'kn' ? 'kn' : 'en';
  } catch {
    return 'en';
  }
};

const POLL_MS = Number(import.meta.env.VITE_POLL_MS) || 5000;

const TABS = [
  { id: 'farmer', label: 'Farmer Analytics', short: 'Analytics', icon: LineChart, blurb: 'Trap insights & advisory' },
  { id: 'check', label: 'Phone Check', short: 'Check', icon: Camera, blurb: 'Photo a trap card, get advice' },
  { id: 'map', label: 'Pest Surveillance Map', short: 'Map', icon: MapIcon, blurb: 'Trap network & outbreak replay' },
  { id: 'admin', label: 'Admin & Hardware Control', short: 'Hardware', icon: Cpu, blurb: 'Devices, battery & capture' },
];

export default function App() {
  const [tab, setTab] = useState('farmer');
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [lang, setLangState] = useState(storedLang);
  const setLang = useCallback((l) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }, []);
  const translated = TRANSLATED_TABS.includes(tab);
  const effectiveLang = translated ? lang : 'en';
  const langValue = useMemo(() => ({ lang: effectiveLang, setLang }), [effectiveLang, setLang]);
  useEffect(() => {
    document.documentElement.lang = effectiveLang;
  }, [effectiveLang]);

  const seq = useRef(0); // only the newest response may update state
  const inFlight = useRef(null); // device id of the poll currently running

  /** Pulls devices + history for the selected device. Never throws; keeps last good data on failure. */
  const refresh = useCallback(async () => {
    if (inFlight.current === (deviceId ?? '')) return; // slow backend: don't stack polls
    inFlight.current = deviceId ?? '';
    const mine = ++seq.current;
    try {
      const devs = await api.devices();
      const active = deviceId && devs.some((d) => d.id === deviceId) ? deviceId : devs[0]?.id ?? null;
      const rows = active ? await api.telemetry(active, 60) : [];
      if (mine !== seq.current) return; // a newer refresh (e.g. device switch) superseded this one
      setDevices(devs);
      if (active !== deviceId) setDeviceId(active);
      setTelemetry(rows);
      setError(null);
      setLastSync(new Date());
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      if (mine === seq.current) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [deviceId]);

  // Live polling (one interval per selected device; cleaned up on change/unmount)
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Integration status: refreshed every minute so a backend restart with new keys shows up
  useEffect(() => {
    const load = () => api.health().then(setHealth).catch(() => setHealth(null));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const selectDevice = (id) => {
    setTelemetry([]); // never show one device's captures under another's name
    setDeviceId(id);
  };

  /** Optimistically patch a device locally (used by the battery slider). */
  const patchDevice = useCallback((updated) => {
    setDevices((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
  }, []);

  const onManualRefresh = async () => {
    setManualRefresh(true);
    await refresh();
    setManualRefresh(false);
  };

  const device = devices.find((d) => d.id === deviceId) ?? null;
  const lowBattery = useMemo(() => devices.filter((d) => d.battery_level < LOW_BATTERY), [devices]);
  const current = TABS.find((t) => t.id === tab);

  return (
    <LanguageContext.Provider value={langValue}>
    <MotionConfig reducedMotion="user">
      <AmbientBackground />
      <InteractionEffects />
      <ScrollProgress />
      <BackToTop />
      <div className="relative z-10 mx-auto flex max-w-[1480px] gap-6 px-4 sm:px-6 lg:px-8">
        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 py-6 lg:flex">
          <Brand />
          <LayoutGroup id="side-nav">
            <nav className="flex flex-col gap-1" aria-label="Main">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Workspace</p>
              {TABS.map((t) => (
                <SideNavItem key={t.id} item={t} active={tab === t.id} onClick={() => setTab(t.id)} />
              ))}
            </nav>
          </LayoutGroup>

          {devices.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Trap station</p>
              <DevicePicker devices={devices} deviceId={deviceId} onSelect={selectDevice} className="w-full" />
            </div>
          )}

          <SystemStatus health={health} />
          <p className="mt-auto px-3 text-[11px] text-slate-600">Agrisense AI · decision support, not a diagnosis</p>
        </aside>

        {/* ---------- Main column ---------- */}
        <main className="min-w-0 flex-1 pb-16 pt-4 lg:pt-6">
          {/* Background refresh indicator */}
          <div className="fixed inset-x-0 top-0 z-50 h-0.5">
            {manualRefresh && <div className="progress-indeterminate" />}
          </div>

          <header className="mb-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="lg:hidden">
                <Brand compact />
              </div>
              <motion.div
                key={tab}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="hidden lg:block"
              >
                <p className="text-xs font-medium text-emerald-400/80">Agrisense / {current.short}</p>
                <WordReveal as="h1" text={current.label} className="title-underline text-2xl font-semibold tracking-tight text-white" />

              </motion.div>

              <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                {translated && <LanguageToggle />}
                <AnimatePresence>
                  {lowBattery.length > 0 && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      onClick={() => setTab('admin')}
                      className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1.5 font-semibold text-rose-300 ring-1 ring-rose-500/50 transition hover:bg-rose-500/25"
                    >
                      <TriangleAlert className="h-3.5 w-3.5 animate-pulse" />
                      {lowBattery.length} trap{lowBattery.length > 1 ? 's' : ''} low on battery
                    </motion.button>
                  )}
                </AnimatePresence>
                <span
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 ring-1 transition-colors duration-300 ${
                    error ? 'bg-rose-500/10 text-rose-300 ring-rose-500/40' : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/40'
                  }`}
                >
                  {error ? <WifiOff className="h-3.5 w-3.5" /> : <span className="live-dot text-emerald-400" />}
                  {error ? 'Offline' : lastSync ? `Live · ${lastSync.toLocaleTimeString()}` : 'Connecting…'}
                </span>
                <button
                  onClick={onManualRefresh}
                  className="btn btn-ghost h-8 w-8 rounded-full p-0"
                  title="Refresh now"
                  aria-label="Refresh now"
                >
                  <RefreshCw className={`h-3.5 w-3.5 transition-transform ${manualRefresh ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Mobile / tablet: segmented nav + device picker + compact status */}
            <div className="flex flex-col gap-3 lg:hidden">
              <LayoutGroup id="top-nav">
                <nav className="relative grid grid-cols-4 rounded-2xl bg-slate-900/70 p-1 ring-1 ring-emerald-900/40" aria-label="Main">
                  {TABS.map(({ id, short, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      aria-current={tab === id ? 'page' : undefined}
                      className={`relative flex items-center justify-center gap-1.5 rounded-xl px-1.5 py-2 text-xs font-medium transition-colors duration-200 sm:gap-2 sm:px-3 sm:text-sm ${
                        tab === id ? 'text-slate-950' : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {tab === id && (
                        <motion.span
                          layoutId="nav-pill"
                          className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-400 to-lime-400 shadow-lg shadow-emerald-500/30"
                          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                        />
                      )}
                      <Icon className="relative h-4 w-4" />
                      <span className="relative">{short}</span>
                    </button>
                  ))}
                </nav>
              </LayoutGroup>
              {devices.length > 0 && <DevicePicker devices={devices} deviceId={deviceId} onSelect={selectDevice} />}
              {health && <StatusChips health={health} />}
            </div>
          </header>

          <AnimatePresence>
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="mb-6 overflow-hidden rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
              >
                {error}
                {lastSync && (
                  <span className="block text-xs text-rose-300/80">
                    Showing the last data loaded at {lastSync.toLocaleTimeString()} - it may be out of date.
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <DashboardSkeleton />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={tab} {...pageTransition}>
                {tab === 'farmer' ? (
                  <FarmerDashboard
                    device={device}
                    devices={devices}
                    onSelectDevice={selectDevice}
                    telemetry={telemetry}
                    onGoAdmin={() => setTab('admin')}
                  />
                ) : tab === 'check' ? (
                  <PhoneCheckPage />
                ) : tab === 'map' ? (
                  <Suspense fallback={<DashboardSkeleton />}>
                    <PestMapPage />
                  </Suspense>
                ) : (
                  <AdminPanel
                    devices={devices}
                    activeDeviceId={deviceId}
                    adminAuthRequired={health?.auth?.admin === 'required'}
                    onDevicePatched={patchDevice}
                    onIngested={refresh}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
    </MotionConfig>
    </LanguageContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */

function Brand({ compact = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={`flex items-center gap-3 ${compact ? '' : 'px-2'}`}
    >
      <motion.div
        whileHover={{ rotate: -8, scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-lime-500 text-slate-950 shadow-lg shadow-emerald-500/30"
      >
        <Sprout className="h-5 w-5" />
        <span className="live-dot absolute! -right-0.5 -top-0.5 h-2.5! w-2.5! text-lime-300 ring-2 ring-slate-950" />
      </motion.div>
      <div className="leading-tight">
        <div className="text-lg font-bold tracking-tight text-white">
          Agrisense <span className="bg-gradient-to-r from-emerald-300 to-lime-300 bg-clip-text text-transparent">AI</span>
        </div>
        <p className="text-[11px] text-slate-400">Predictive Insect Monitoring</p>
      </div>
    </motion.div>
  );
}

function SideNavItem({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${
        active ? 'text-white' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-100'
      }`}
    >
      {active && (
        <motion.span
          layoutId="side-pill"
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 ring-1 ring-emerald-400/30"
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400" />
        </motion.span>
      )}
      <span
        className={`relative grid h-8 w-8 place-items-center rounded-lg transition-all duration-300 ${
          active ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/30' : 'bg-slate-800/60 group-hover:-rotate-6 group-hover:scale-110 group-hover:bg-slate-700/60'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="relative min-w-0">
        <span className="block truncate text-sm font-medium">{item.label}</span>
        <span className="block truncate text-[11px] text-slate-500">{item.blurb}</span>
      </span>
    </button>
  );
}

function DevicePicker({ devices, deviceId, onSelect, className = '' }) {
  return (
    <label className={`flex items-center gap-2 text-sm text-slate-400 ${className}`}>
      <Bug className="h-4 w-4 shrink-0 text-emerald-400" />
      <select value={deviceId ?? ''} onChange={(e) => onSelect(e.target.value)} className="field w-full min-w-0 px-3 py-2 text-sm">
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.battery_level}%)
          </option>
        ))}
      </select>
    </label>
  );
}

const PROVIDER_NAMES = { gemini: 'Gemini', claude: 'Claude' };

function statusRows(health) {
  return [
    { icon: Database, label: 'Database', value: health.store === 'memory' ? 'In-memory' : 'Supabase', ok: health.store !== 'memory' },
    {
      icon: Camera,
      label: 'Vision',
      value: health.integrations.yolo ? health.services?.vision?.provider ?? 'API' : 'Demo traps only',
      ok: health.integrations.yolo,
    },
    {
      icon: BrainCircuit,
      label: 'Advisory',
      value: PROVIDER_NAMES[health.services?.advisor?.provider] ?? 'Rule engine',
      ok: Boolean(PROVIDER_NAMES[health.services?.advisor?.provider]),
    },
  ];
}

/** Sidebar card: configured integrations (states only, never secrets). */
function SystemStatus({ health }) {
  if (!health) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.15 }}
      className="card p-4!"
      title="Configured integrations (per-capture results are labelled on each card)"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">System</span>
        {health.mode === 'demo' && (
          <span className="shine rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/40">DEMO</span>
        )}
      </div>
      <ul className="flex flex-col gap-2.5">
        {statusRows(health).map(({ icon: Icon, label, value, ok }) => (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <Icon className="h-4 w-4 text-slate-500" />
            <span className="text-slate-400">{label}</span>
            <span className={`ml-auto flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-300' : 'text-slate-400'}`}>
              <span className={ok ? 'live-dot h-1.5! w-1.5! text-emerald-400' : 'h-1.5 w-1.5 rounded-full bg-slate-500'} />
              {value}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

/** Compact integration summary for small screens. */
function StatusChips({ health }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {health.mode === 'demo' && <span className="rounded-full bg-amber-500/15 px-2 py-1 font-bold text-amber-300 ring-1 ring-amber-500/40">DEMO</span>}
      {statusRows(health).map(({ label, value, ok }) => (
        <span key={label} className="rounded-full bg-slate-800/70 px-2 py-1 text-slate-300 ring-1 ring-slate-700">
          {label}: <span className={ok ? 'text-emerald-300' : ''}>{value}</span>
        </span>
      ))}
    </div>
  );
}
