import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BatteryMedium, Bug, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { decisionStyle } from '../lib/decision.js';
import { EASE } from '../lib/motion.jsx';
import DecisionBadge from './DecisionBadge.jsx';

/**
 * One card per trap with its traffic-light decision (from GET /api/decision).
 * `refreshKey` changes when a new capture arrives so the cards follow it.
 */
export default function TrapCards({ devices, activeId, onSelect, refreshKey }) {
  const [decisions, setDecisions] = useState({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      devices.map((d) =>
        api
          .decision(d.id)
          .then((r) => [d.id, r])
          .catch((err) => [d.id, { error: err.message }])
      )
    ).then((pairs) => !cancelled && setDecisions(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [devices, refreshKey]);

  if (!devices.length) return null;

  return (
    <section aria-label="Trap decisions" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {devices.map((d, i) => (
        <TrapCard key={d.id} device={d} result={decisions[d.id]} active={d.id === activeId} onSelect={onSelect} index={i} />
      ))}
    </section>
  );
}

function TrapCard({ device, result, active, onSelect, index }) {
  const style = decisionStyle(result?.decision);
  const loading = result === undefined;
  return (
    <motion.button
      type="button"
      onClick={() => onSelect?.(device.id)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: 0.05 * index }}
      aria-pressed={active}
      data-testid="trap-card"
      className={`card card-hover relative flex flex-col gap-2 overflow-hidden p-4! text-left ring-1 transition ${
        active ? 'ring-emerald-400/60' : 'ring-transparent'
      }`}
    >
      {/* traffic-light edge */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: style?.color ?? '#334155' }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold leading-snug break-words text-white">{device.name}</div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <BatteryMedium className="h-3.5 w-3.5" /> {device.battery_level}%{active && <span className="text-emerald-300">· viewing</span>}
          </div>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        ) : style ? (
          <DecisionBadge decision={result.decision} borderline={result.borderline} />
        ) : (
          <span className="text-xs text-slate-500">{result?.error ? 'Unavailable' : 'No data yet'}</span>
        )}
      </div>
      {result?.decision && !result.check_trap && (
        <div className="flex flex-wrap gap-x-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Bug className="h-3.5 w-3.5" /> {result.avg_pests} pests/day
          </span>
          <span>{result.no_predators ? 'no predators' : `${result.pests_per_predator} per predator`}</span>
          <span>
            {result.window?.days}-day avg{result.simulated ? ' · simulated' : ''}
          </span>
        </div>
      )}
      {result?.reason && <p className="line-clamp-2 text-xs leading-snug text-slate-400">{result.reason}</p>}
    </motion.button>
  );
}
