import { useEffect, useRef } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { Eye, EyeOff, GripVertical, Monitor, Moon, RotateCcw, Sun, X } from 'lucide-react';
import { SECTIONS, haptic } from '../lib/theme.js';

const SHEET = { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 };
const THEME_OPTIONS = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'auto', label: 'Auto', icon: Monitor },
];

/**
 * Customize: drag sections into any order, hide the ones you don't need,
 * pick the theme. A sheet from the right (bottom on phones); Esc or a swipe
 * down / tap outside closes it.
 */
export default function CustomizeSheet({ open, onClose, layout, setLayout, reset, theme, setTheme }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    panel.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  const byId = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
  const toggle = (id) => {
    haptic();
    const hidden = layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id];
    setLayout({ ...layout, hidden });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="sheet"
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customize-title"
            className="glass fixed inset-x-0 bottom-0 z-[71] flex max-h-[85vh] flex-col rounded-t-[1.75rem] shadow-[var(--elev-4)] ring-1 ring-line outline-none sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:max-h-none sm:w-[400px] sm:rounded-[1.75rem]"
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.6 }}
            transition={SHEET}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 600) && onClose()}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between px-6 pb-2 pt-4">
              <h2 id="customize-title" className="text-lg font-semibold tracking-tight text-ink">
                Customize dashboard
              </h2>
              <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full hover:bg-slate-100" aria-label="Close">
                <X className="h-5 w-5 text-slate-600" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Appearance</p>
              <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1" role="radiogroup" aria-label="Theme">
                {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={theme === id}
                    onClick={() => {
                      haptic();
                      setTheme(id);
                    }}
                    className={`relative flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-colors ${
                      theme === id ? 'text-ink' : 'text-slate-500 hover:text-ink'
                    }`}
                  >
                    {theme === id && <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-xl bg-surface shadow-[var(--elev-2)]" transition={SHEET} />}
                    <Icon className="relative h-4 w-4" aria-hidden="true" />
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>

              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Sections · drag to reorder</p>
              <Reorder.Group axis="y" values={layout.order} onReorder={(order) => setLayout({ ...layout, order })} className="flex flex-col gap-2">
                {layout.order.map((id, i) => (
                  <Row
                    key={id}
                    id={id}
                    label={byId[id]?.label ?? id}
                    hidden={layout.hidden.includes(id)}
                    onToggle={() => toggle(id)}
                    onMove={(dir) => {
                      const j = i + dir;
                      if (j < 0 || j >= layout.order.length) return;
                      const order = [...layout.order];
                      [order[i], order[j]] = [order[j], order[i]];
                      setLayout({ ...layout, order });
                    }}
                  />
                ))}
              </Reorder.Group>

              <button type="button" onClick={reset} className="btn btn-ghost mt-5 w-full">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset layout
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Row({ id, label, hidden, onToggle, onMove }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.03, boxShadow: 'var(--elev-4)' }}
      className="flex items-center gap-2 rounded-2xl bg-surface p-1.5 pr-2 shadow-[var(--elev-1)] ring-1 ring-line"
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') (e.preventDefault(), onMove(-1));
          if (e.key === 'ArrowDown') (e.preventDefault(), onMove(1));
        }}
        className="grid h-11 w-9 cursor-grab touch-none place-items-center rounded-xl text-slate-400 active:cursor-grabbing"
        aria-label={`Move ${label} (drag, or use the up and down arrow keys)`}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className={`flex-1 text-sm ${hidden ? 'text-slate-500 line-through' : 'text-ink'}`}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={!hidden}
        onClick={onToggle}
        className="grid h-11 w-11 place-items-center rounded-full hover:bg-slate-100"
        aria-label={`Show ${label}`}
      >
        {hidden ? <EyeOff className="h-4 w-4 text-slate-500" aria-hidden="true" /> : <Eye className="h-4 w-4 text-brand" aria-hidden="true" />}
      </button>
    </Reorder.Item>
  );
}
