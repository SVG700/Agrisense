import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Box, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import DecisionBadge from './DecisionBadge.jsx';
import { useT } from '../lib/i18n.jsx';

// deck.gl is only downloaded when the 3D view is actually shown
const Field3DScene = lazy(() => import('./Field3DScene.jsx'));

/** True when the browser can draw WebGL2 (deck.gl's requirement). */
function hasWebGL() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

/**
 * 3D farm view: every trap is a pillar on the field. Height = pests per day
 * (3-day average), colour + shape = the trap's decision, the glass plane is
 * the action level. Click a pillar to open that trap. A plain list is always
 * rendered for screen readers (and shown instead when WebGL is unavailable).
 */
export default function Field3D({ devices, activeId, onSelect, refreshKey }) {
  const t = useT();
  const [decisions, setDecisions] = useState({});
  const [webgl] = useState(hasWebGL);
  const ids = devices.map((d) => d.id).join(',');

  useEffect(() => {
    let cancelled = false;
    for (const id of ids ? ids.split(',') : []) {
      api
        .decision(id)
        .catch((err) => ({ error: err.message }))
        .then((r) => !cancelled && setDecisions((prev) => ({ ...prev, [id]: r })));
    }
    return () => {
      cancelled = true;
    };
  }, [ids, refreshKey]);

  const traps = useMemo(
    () =>
      devices.map((d) => {
        const r = decisions[d.id];
        return {
          id: d.id,
          name: d.name,
          loaded: r !== undefined,
          decision: r?.decision ?? null,
          borderline: Boolean(r?.borderline),
          pests: Number.isFinite(r?.avg_pests) ? r.avg_pests : null,
          perPredator: r?.no_predators ? null : r?.pests_per_predator ?? null,
          threshold: r?.thresholds?.action_threshold_per_day ?? null,
        };
      }),
    [devices, decisions]
  );
  const threshold = traps.find((x) => x.threshold)?.threshold ?? 25;
  const loading = traps.some((x) => !x.loaded);

  if (!devices.length) return null;

  return (
    <section className="card overflow-hidden p-0!" aria-labelledby="field3d-title">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 id="field3d-title" className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Box className="h-4 w-4" aria-hidden="true" />
            </span>
            3D farm view
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Each pillar is a trap. Taller = more pests per day. The glass plane is the action level ({threshold}/day). Drag to
            rotate, scroll to zoom, click a pillar to open that trap.
          </p>
        </div>
        <Legend />
      </div>

      <div className="relative mt-4 h-[420px] border-t border-line bg-gradient-to-b from-sky-50 to-canvas sm:h-[480px]">
        {webgl ? (
          <Suspense fallback={<SceneLoading />}>
            <Field3DScene traps={traps} activeId={activeId} threshold={threshold} onSelect={onSelect} />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-500">
            3D view needs WebGL, which this browser has turned off. The traps are listed below.
          </div>
        )}
        {loading && webgl && (
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs text-slate-600 ring-1 ring-line">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading trap decisions…
          </span>
        )}
        <span className="pointer-events-none absolute bottom-3 right-4 text-[11px] text-slate-500">Layout not to scale</span>
      </div>

      {/* Same information as the scene, as a list (screen readers always; everyone when there is no WebGL) */}
      <ul className={webgl ? 'sr-only' : 'grid gap-2 p-5 sm:grid-cols-2'} aria-label="Traps in the 3D view">
        {traps.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-line">
            <button className="text-left font-medium text-ink hover:underline" onClick={() => onSelect?.(x.id)}>
              {x.name}
            </button>
            <span className="flex items-center gap-2 text-slate-600">
              {x.pests !== null ? `${x.pests} pests/day` : t('trap.noData')}
              {x.decision && <DecisionBadge decision={x.decision} borderline={x.borderline} size="sm" />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Legend() {
  const items = [
    ['▲', 'Spray', '#e11d48'],
    ['◆', 'Biocontrol', '#d97706'],
    ['●', 'Wait', '#16a34a'],
    ['■', 'Check trap', '#64748b'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600" aria-label="Pillar colours">
      {items.map(([shape, label, color]) => (
        <li key={label} className="flex items-center gap-1">
          <span aria-hidden="true" style={{ color }}>
            {shape}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

function SceneLoading() {
  return (
    <div className="grid h-full place-items-center text-sm text-slate-500">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading 3D engine…
      </span>
    </div>
  );
}
