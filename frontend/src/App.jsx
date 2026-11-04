import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useScroll, useMotionValueEvent } from 'framer-motion';
import { Bell, Bug, Camera, ChevronDown, Cpu, LayoutDashboard, Map as MapIcon, Moon, RefreshCw, Search, Sprout, Sun, WifiOff } from 'lucide-react';
import { api } from './api.js';
import { LOW_BATTERY } from './lib/pests.js';
import { pageTransition, useLiquid } from './lib/motion.jsx';
import { LanguageContext, LanguageToggle } from './lib/i18n.jsx';
import { haptic, useLayout, useTheme } from './lib/theme.js';
import { BackToTop, InteractionEffects, ScrollProgress } from './components/InteractionEffects.jsx';
import FarmerDashboard from './components/FarmerDashboard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import PhoneCheckPage from './components/PhoneCheckPage.jsx';
import { DashboardSkeleton } from './components/Skeletons.jsx';
import { StatusChips } from './components/SystemStatus.jsx';
import CustomizeSheet from './components/CustomizeSheet.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Backdrop from './components/Backdrop.jsx';

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
// One spring for the whole app: quick to respond, settles without bounce (Apple-like)
const APP_SPRING = { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 };

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
  const [live, setLive] = useState(true);
  const [customizing, setCustomizing] = useState(false);
  const [palette, setPalette] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { theme, resolved, setTheme } = useTheme();
  const { layout, setLayout, reset: resetLayout } = useLayout();
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

  // The header gains elevation once the page scrolls under it
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 8));

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

  // Live polling (paused from the Insects card; one interval per selected device)
  useEffect(() => {
    refresh();
    if (!live) return undefined;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, live]);

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
    haptic();
    setManualRefresh(true);
    await refresh();
    setManualRefresh(false);
  };

  const goTab = useCallback((id) => {
    haptic();
    setTab(id);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }, []);

  // Keyboard: Ctrl/⌘+K or "/" opens quick actions (not while typing in a field)
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const device = devices.find((d) => d.id === deviceId) ?? null;
  const lowBattery = useMemo(() => devices.filter((d) => d.battery_level < LOW_BATTERY), [devices]);
  const nextTheme = resolved === 'dark' ? 'light' : 'dark';

  const commands = useMemo(
    () => [
      ...TABS.map((t) => ({ id: `go-${t.id}`, group: 'Go to', label: t.label, run: () => goTab(t.id) })),
      ...devices.map((d) => ({ id: `trap-${d.id}`, group: 'Trap', label: `Open ${d.name}`, hint: `${d.battery_level}% battery`, run: () => selectDevice(d.id) })),
      { id: 'refresh', group: 'Data', label: 'Refresh now', run: onManualRefresh },
      { id: 'live', group: 'Data', label: live ? 'Pause live updates' : 'Resume live updates', run: () => setLive((l) => !l) },
      { id: 'customize', group: 'View', label: 'Customize dashboard', run: () => (goTab('farmer'), setCustomizing(true)) },
      { id: 'theme-dark', group: 'Appearance', label: 'Dark theme', run: () => setTheme('dark') },
      { id: 'theme-light', group: 'Appearance', label: 'Light theme', run: () => setTheme('light') },
      { id: 'theme-auto', group: 'Appearance', label: 'Match system theme', run: () => setTheme('auto') },
      { id: 'lang-en', group: 'Language', label: 'English', run: () => setLang('en') },
      { id: 'lang-kn', group: 'Language', label: 'ಕನ್ನಡ (Kannada)', run: () => setLang('kn') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devices, live, goTab, setTheme, setLang]
  );

  return (
    <LanguageContext.Provider value={langValue}>
      <MotionConfig reducedMotion="user" transition={APP_SPRING}>
        <a
          href="#main"
          className="sr-only z-[90] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <InteractionEffects />
        <ScrollProgress />
        <BackToTop />

        {/* Background refresh indicator */}
        <div className="fixed inset-x-0 top-0 z-50 h-0.5">{manualRefresh && <div className="progress-indeterminate" />}</div>

        <Backdrop />
        <div className="lg:px-6 lg:pt-6">
        <div className="app-window silver silver-live mx-auto max-w-[1440px] overflow-clip lg:rounded-[44px]">
        {/* ---------- Top bar (reference: logo · links · search · dark pill · bell · avatar) ---------- */}
        <header
          className={`silver-rule sticky top-0 z-40 transition-[background-color,box-shadow] duration-500 ${scrolled ? 'is-scrolled glass shadow-[var(--elev-2)]' : ''}`}
        >
          <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:px-6 lg:h-[84px] lg:px-10">
            <Brand />

            <LayoutGroup id="top-nav">
              <nav className="ml-4 hidden items-center gap-0.5 lg:flex xl:ml-8" aria-label="Main">
                {TABS.map((t) => (
                  <NavLink key={t.id} item={t} active={tab === t.id} onClick={() => goTab(t.id)} />
                ))}
              </nav>
            </LayoutGroup>

            <div className="ml-auto flex min-w-0 items-center gap-2 text-xs">
              <SearchPill onOpen={() => setPalette(true)} />
              <span
                role="status"
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 font-medium ${
                  error ? 'bg-rose-50 text-rose-700' : !live ? 'bg-amber-50 text-amber-800' : 'text-slate-600'
                }`}
                title={lastSync ? `Last update ${lastSync.toLocaleTimeString()}` : undefined}
              >
                {error ? <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> : <span className={live ? 'live-dot text-emerald-500' : 'h-2 w-2 rounded-full bg-amber-500'} aria-hidden="true" />}
                <span className={error || !live ? '' : 'hidden xl:inline'}>{error ? 'Offline' : !live ? 'Paused' : lastSync ? 'Live' : 'Connecting…'}</span>
              </span>
              {translated && <LanguageToggle />}
              <LiquidPill onClick={() => (goTab('farmer'), setCustomizing(true))} className="hidden sm:inline-flex">
                Customize
              </LiquidPill>
              <IconButton
                label={lowBattery.length ? `${lowBattery.length} trap${lowBattery.length > 1 ? 's' : ''} low on battery` : 'No alerts'}
                onClick={() => goTab('admin')}
                badge={lowBattery.length || null}
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
              </IconButton>
              <IconButton label={`Switch to ${nextTheme} theme`} onClick={() => (haptic(), setTheme(nextTheme))} className="bg-gradient-to-br! from-[#f6d867] to-[#c9a227] text-[#2b231c]! ring-[#fff]/70!">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={resolved}
                    initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
                    animate={{ rotate: 0, scale: 1, opacity: 1 }}
                    exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
                    className="grid place-items-center"
                  >
                    {resolved === 'dark' ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
                  </motion.span>
                </AnimatePresence>
              </IconButton>
              <IconButton label="Refresh now" onClick={onManualRefresh} className="hidden! 2xl:grid!">
                <RefreshCw className={`h-4 w-4 ${manualRefresh ? 'animate-spin' : ''}`} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1320px] px-4 pb-32 pt-4 sm:px-6 lg:px-10 lg:pb-16 lg:pt-2">
          {/* Trap picker on pages without the trap rail */}
          {devices.length > 0 && (tab === 'check' || tab === 'admin') && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <TrapPicker devices={devices} deviceId={deviceId} onSelect={selectDevice} />
            </div>
          )}

          <AnimatePresence>
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
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
                    layout={layout}
                    live={live}
                    onToggleLive={() => setLive((l) => !l)}
                    onCustomize={() => setCustomizing(true)}
                    onAddTrap={async (name) => {
                      const created = await api.createDevice(name);
                      await refresh();
                      if (created?.id) selectDevice(created.id);
                    }}
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

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 py-6 pb-28 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 lg:pb-6">
            <span className="flex items-center gap-2">
              <Sprout className="h-4 w-4 text-brand" aria-hidden="true" />
              AgriSense AI · decision support, not a diagnosis - scout the crop before treating.
            </span>
            {health && <StatusChips health={health} />}
          </div>
        </footer>
        </div>
        </div>

        {/* ---------- Phone tab bar (thumb reach, safe-area aware) ---------- */}
        <LayoutGroup id="tab-bar">
          <nav className="glass silver pb-safe fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-[1.6rem] p-1.5 shadow-[var(--elev-4)] ring-1 ring-line lg:hidden" aria-label="Main">
            {TABS.map(({ id, short, icon: Icon }) => (
              <motion.button
                key={id}
                onClick={() => goTab(id)}
                whileTap={{ scale: 0.92 }}
                aria-current={tab === id ? 'page' : undefined}
                className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium ${tab === id ? 'text-ink' : 'text-slate-500'}`}
              >
                {tab === id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-2xl bg-slate-100" />}
                <Icon className="relative h-5 w-5" aria-hidden="true" />
                <span className="relative">{short}</span>
              </motion.button>
            ))}
          </nav>
        </LayoutGroup>

        <CustomizeSheet
          open={customizing}
          onClose={() => setCustomizing(false)}
          layout={layout}
          setLayout={setLayout}
          reset={resetLayout}
          theme={theme}
          setTheme={setTheme}
        />
        <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />

      </MotionConfig>
    </LanguageContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */

function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <svg width="28" height="22" viewBox="0 0 28 22" aria-hidden="true">
        <path d="M3 4 H17 L22 9 H8 Z" fill="#f2c230" />
        <path d="M6 13 H20 L25 18 H11 Z" fill="#e0a915" />
      </svg>
      <span className="text-[22px] font-semibold tracking-tight text-ink">agrisense</span>
    </div>
  );
}

/** Reference search field: opens Quick actions (pages, traps, actions). */
function SearchPill({ onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hidden h-10 w-[min(20vw,280px)] items-center gap-2 rounded-full bg-surface/90 px-4 text-sm text-slate-500 shadow-[var(--elev-1)] ring-1 ring-line transition-[box-shadow] hover:shadow-[var(--elev-2)] md:flex"
      aria-label="Search (Ctrl+K)"
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span className="flex-1 text-left">Search</span>
      <kbd className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Ctrl K</kbd>
    </button>
  );
}

/** Reference dark pill ("Upgrade"), with a liquid fill from the pointer. */
function LiquidPill({ onClick, className = '', children }) {
  const liquid = useLiquid(0.15);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      {...liquid}
      className={`${liquid.className} h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-cocoa px-5 text-sm font-medium text-[#fff] shadow-[var(--elev-2)] [--liquid:#5a4636] [:root[data-theme=dark]_&]:text-[#2b231c] [:root[data-theme=dark]_&]:[--liquid:#ffffff] ${className}`}
    >
      {children}
    </motion.button>
  );
}

/** Text link with the reference's sliding underline. */
function NavLink({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative whitespace-nowrap px-3 py-2.5 text-[15px] transition-colors duration-300 ${active ? 'font-medium text-ink' : 'text-slate-500 hover:text-ink'}`}
    >
      <span className="xl:hidden">{item.short}</span>
      <span className="hidden xl:inline">{item.label}</span>
      {active && <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 0.6 }} />}
    </button>
  );
}

function IconButton({ label, onClick, badge = null, className = '', children }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-[var(--elev-1)] ring-1 ring-line transition-colors hover:bg-slate-100 ${className}`}
    >
      {children}
      {badge && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-[#fff]" aria-hidden="true">
          {badge}
        </span>
      )}
    </motion.button>
  );
}

/** The reference's account pill, as the trap selector. */
function TrapPicker({ devices, deviceId, onSelect, className = '' }) {
  const current = devices.find((d) => d.id === deviceId);
  return (
    <label className={`relative flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 shadow-[var(--elev-1)] ring-1 ring-line ${className}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
        <Bug className="h-4 w-4" />
      </span>
      <span className="sr-only">Trap station</span>
      <select
        value={deviceId ?? ''}
        onChange={(e) => (haptic(), onSelect(e.target.value))}
        className="max-w-[220px] cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-medium text-ink outline-none"
      >
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.battery_level}%)
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500" aria-hidden="true" />
      {current && current.battery_level < LOW_BATTERY && <span className="sr-only">low battery</span>}
    </label>
  );
}
