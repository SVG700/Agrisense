import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, LocateFixed, MapPin, Search } from 'lucide-react';
import { api } from '../api.js';
import { usePlace } from '../lib/place.js';
import { haptic } from '../lib/theme.js';
import { useT } from '../lib/i18n.jsx';

const SPRING = { type: 'spring', stiffness: 320, damping: 30 };

/**
 * Where the live weather comes from: type an address / village, use this
 * device's location, or go back to the farm default.
 */
export default function LocationPicker({ label, className = '' }) {
  const t = useT();
  const [place, setPlace] = usePlace();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(null); // 'search' | 'locate' | null
  const [err, setErr] = useState(null);
  const box = useRef(null);

  // Debounced search as you type
  useEffect(() => {
    if (!open || q.trim().length < 2) return setResults([]);
    setBusy('search');
    const id = setTimeout(() => {
      api
        .places(q.trim())
        .then((r) => (setResults(r), setErr(r.length ? null : t('place.none'))))
        .catch((e) => setErr(e.message))
        .finally(() => setBusy(null));
    }, 350);
    return () => clearTimeout(id);
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (p) => {
    haptic();
    setPlace(p);
    setOpen(false);
    setQ('');
    setResults([]);
    setErr(null);
  };

  const locate = () => {
    if (!navigator.geolocation) return setErr(t('place.noGeo'));
    setBusy('locate');
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = Math.round(coords.latitude * 1e4) / 1e4;
        const lon = Math.round(coords.longitude * 1e4) / 1e4;
        let name = `${lat}, ${lon}`;
        try {
          name = (await api.placeName(lat, lon)).label;
        } catch {
          /* keep coordinates */
        }
        setBusy(null);
        choose({ lat, lon, label: name, mine: true });
      },
      (e) => {
        setBusy(null);
        setErr(e.code === 1 ? t('place.denied') : t('place.noFix'));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 text-xs text-slate-700 transition-colors hover:bg-slate-200"
        title={t('place.change')}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-[#c9a227]" aria-hidden="true" />
        <span className="truncate">{label ?? place?.label ?? t('place.farm')}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t('place.change')}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SPRING}
            className="absolute left-0 top-10 z-40 w-80 max-w-[calc(100vw-2rem)] origin-top-left rounded-2xl bg-surface p-2 shadow-[var(--elev-4)] ring-1 ring-line"
          >
            <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 ring-1 ring-line focus-within:ring-[#c9a227]">
              <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span className="sr-only">{t('place.search')}</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('place.search')}
                className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-500"
              />
              {busy === 'search' && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" aria-hidden="true" />}
            </label>

            <div className="mt-1 flex flex-col">
              <Option icon={LocateFixed} onClick={locate} busy={busy === 'locate'}>
                {t('place.mine')}
              </Option>
              <Option icon={Home} onClick={() => choose(null)} selected={!place}>
                {t('place.farm')}
              </Option>
            </div>

            {results.length > 0 && (
              <ul className="mt-1 max-h-60 overflow-y-auto border-t border-line pt-1" aria-label={t('place.results')}>
                {results.map((r) => (
                  <li key={`${r.lat},${r.lon}`}>
                    <Option icon={MapPin} onClick={() => choose({ lat: r.lat, lon: r.lon, label: r.label })}>
                      {r.label}
                    </Option>
                  </li>
                ))}
              </ul>
            )}
            {err && <p className="px-3 py-2 text-xs text-rose-700">{err}</p>}
            <p className="px-3 pb-1 pt-2 text-[10px] text-slate-500">{t('place.credit')}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Option({ icon: Icon, onClick, busy, selected, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors ${selected ? 'bg-butter-soft text-ink' : 'text-slate-700 hover:bg-slate-50'}`}
    >
      {busy ? (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" aria-hidden="true" />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      )}
      <span className="line-clamp-2">{children}</span>
    </button>
  );
}
