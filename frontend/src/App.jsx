import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion';
import { Bug, Camera, Cpu, LayoutDashboard, Map as MapIcon, RefreshCw, Sprout, TriangleAlert, WifiOff } from 'lucide-react';
import { api } from './api.js';
import { LOW_BATTERY } from './lib/pests.js';
import { EASE, pageTransition } from './lib/motion.jsx';
import { LanguageContext, LanguageToggle } from './lib/i18n.jsx';
import { BackToTop, InteractionEffects, ScrollProgress } from './components/InteractionEffects.jsx';
import FarmerDashboard from './components/FarmerDashboard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import PhoneCheckPage from './components/PhoneCheckPage.jsx';
import { DashboardSkeleton } from './components/Skeletons.jsx';
import { StatusChips } from './components/SystemStatus.jsx';

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
  { id: 'farmer', label: 'Dashboard', short: 'Dashboard', icon: LayoutDashboard },
  { id: 'check', label: 'Phone Check', short: 'Check', icon: Camera },
  { id: 'map', label: 'Pest Surveillance Map', short: 'Map', icon: MapIcon },
  { id: 'admin', label: 'Admin & Hardware', short: 'Hardware', icon: Cpu },
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

  const goTab = (id) => {
    setTab(id);
    window.scrollTo?.({ top: 0 });
  };

  const device = devices.find((d) => d.id === deviceId) ?? null;
  const lowBattery = useMemo(() => devices.filter((d) => d.battery_level < LOW_BATTERY), [devices]);

  return (
    <LanguageContext.Provider value={langValue}>
      <MotionConfig reducedMotion="user">
        <a
          href="#main"
          className="sr-only z-[60] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <InteractionEffects />
        <ScrollProgress />
        <BackToTop />

        {/* Background refresh indicator */}
        <div className="fixed inset-x-0 top-0 z-50 h-0.5">{manualRefresh && <div className="progress-indeterminate" />}</div>

        {/* ---------- Top bar ---------- */}
        <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6 lg:px-8">
            <Brand />

            <LayoutGroup id="top-nav">
              <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main">
                {TABS.map((t) => (
                  <NavLink key={t.id} item={t} active={tab === t.id} onClick={() => goTab(t.id)} />
                ))}
              </nav>
            </LayoutGroup>

            <div className="ml-auto flex items-center gap-2 text-xs">
              {translated && <LanguageToggle />}
              <AnimatePresence>
                {lowBattery.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    onClick={() => goTab('admin')}
                    className="hidden items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 sm:flex"
                  >
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    {lowBattery.length} trap{lowBattery.length > 1 ? 's' : ''} low on battery
                  </motion.button>
                )}
              </AnimatePresence>
              <span
                role="status"
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ring-1 ${
                  error ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-brand-soft text-brand ring-emerald-200'
                }`}
              >
                {error ? <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="live-dot text-emerald-500" aria-hidden="true" />}
                {error ? 'Offline' : lastSync ? <span>Live<span className="hidden sm:inline"> · {lastSync.toLocaleTimeString()}</span></span> : 'Connecting…'}
              </span>
              <button onClick={onManualRefresh} className="btn btn-ghost h-9 min-h-0 w-9 p-0" title="Refresh now" aria-label="Refresh now">
                <RefreshCw className={`h-3.5 w-3.5 ${manualRefresh ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Mobile / tablet nav */}
          <nav className="mx-auto flex max-w-[1320px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6 lg:hidden" aria-label="Main">
            {TABS.map(({ id, short, icon: Icon }) => (
              <button
                key={id}
                onClick={() => goTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === id ? 'bg-ink text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {short}
              </button>
            ))}
          </nav>
        </header>

        <main id="main" className="mx-auto max-w-[1320px] px-4 pb-20 pt-6 sm:px-6 lg:px-8">
          {/* Trap picker (shared by every page) */}
          {devices.length > 1 && tab !== 'map' && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="pill-label">Trap station</span>
              <DevicePicker devices={devices} deviceId={deviceId} onSelect={selectDevice} />
            </div>
          )}

          <AnimatePresence>
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="mb-6 overflow-hidden rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                {error}
                {lastSync && (
                  <span className="block text-xs text-rose-700">
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
                    health={health}
                    onGoAdmin={() => goTab('admin')}
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
                    health={health}
                    adminAuthRequired={health?.auth?.admin === 'required'}
                    onDevicePatched={patchDevice}
                    onIngested={refresh}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        <footer className="border-t border-line bg-white">
          <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span className="flex items-center gap-2">
              <Sprout className="h-4 w-4 text-brand" aria-hidden="true" />
              AgriSense AI · decision support, not a diagnosis - scout the crop before treating.
            </span>
            {health && <StatusChips health={health} />}
          </div>
        </footer>
      </MotionConfig>
    </LanguageContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */

function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-white">
        <Sprout className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">AgriSense</div>
        <p className="hidden text-[11px] text-slate-500 sm:block">Predictive insect monitoring</p>
      </div>
    </div>
  );
}

function NavLink({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${active ? 'text-white' : 'text-slate-600 hover:text-ink'}`}
    >
      {active && (
        <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
      )}
      <span className="relative">{item.label}</span>
    </button>
  );
}

function DevicePicker({ devices, deviceId, onSelect }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <Bug className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      <span className="sr-only">Trap station</span>
      <select value={deviceId ?? ''} onChange={(e) => onSelect(e.target.value)} className="field min-w-0 px-3 py-2 text-sm">
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.battery_level}%)
          </option>
        ))}
      </select>
    </label>
  );
}
