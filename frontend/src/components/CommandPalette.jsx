import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Search } from 'lucide-react';

const SPRING = { type: 'spring', stiffness: 420, damping: 36 };

/**
 * Spotlight-style quick actions: Ctrl/⌘ + K (or "/") opens it, type to filter,
 * ↑ ↓ to move, Enter to run, Esc to close. `commands`: [{id, label, hint?, group, run}].
 */
export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => `${c.label} ${c.group} ${c.hint ?? ''}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const run = (c) => {
    onClose();
    c?.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions"
            className="glass w-full max-w-xl overflow-hidden rounded-3xl shadow-[var(--elev-4)] ring-1 ring-line"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={SPRING}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              if (e.key === 'Enter') (e.preventDefault(), run(results[active]));
            }}
          >
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="h-5 w-5 text-slate-500" aria-hidden="true" />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search actions, pages, traps…"
                className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate-500"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
                aria-label="Search actions"
              />
              <kbd className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">Esc</kbd>
            </div>
            <ul id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>}
              {results.map((c, i) => (
                <li
                  key={c.id}
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`relative flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm ${i === active ? 'text-ink' : 'text-slate-600'}`}
                >
                  {i === active && <motion.span layoutId="cmd-active" className="absolute inset-0 rounded-xl bg-slate-100" transition={SPRING} />}
                  <span className="relative flex-1">{c.label}</span>
                  <span className="relative text-xs text-slate-500">{c.hint ?? c.group}</span>
                  {i === active && <CornerDownLeft className="relative h-3.5 w-3.5 text-slate-500" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
