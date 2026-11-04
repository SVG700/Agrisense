import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Droplet, IndianRupee, Leaf, SprayCan } from 'lucide-react';
import { api } from '../api.js';
import { AnimatedNumber, EASE } from '../lib/motion.jsx';
import Badge from './Badge.jsx';
import { useT } from '../lib/i18n.jsx';

const PERIODS = [14, 30];
const inr = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/**
 * Impact ESTIMATE across all traps: sprays avoided vs routine calendar
 * spraying, product and money saved, biocontrol releases. Always labelled as
 * an estimate; the assumptions are one click away.
 */
export default function ImpactCard({ refreshKey }) {
  const t = useT();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .impact(days)
      .then((d) => !cancelled && (setData(d), setFailed(false)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [days, refreshKey]);

  if (failed) return null; // purely informational: never in the way
  if (!data) return <div className="card h-40 animate-pulse" />;
  if (!data.traps) return null;

  const a = data.assumptions;
  const maxBar = Math.max(1, data.calendar_sprays);

  return (
    <section className="card flex flex-col gap-4" data-testid="impact-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Leaf className="h-4 w-4" />
            </span>
            {t('title.impact')}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            All {data.traps} traps, last {data.days} days, compared with spraying every {a.calendar_spray_interval_days} days.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="warn" title={a.placeholder}>
            ESTIMATE
          </Badge>
          {data.simulated && <Badge tone="warn">{data.all_simulated ? 'Simulated data' : 'Includes simulated data'}</Badge>}
          <div className="flex rounded-full ring-1 ring-slate-200">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={`px-2.5 py-0.5 text-[11px] ${p === days ? 'rounded-full bg-emerald-500/20 text-emerald-700' : 'text-slate-500'}`}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={SprayCan} label="Sprays avoided" value={data.sprays_avoided} sub={`${data.percent_fewer_sprays}% fewer than calendar`} accent="text-emerald-700" />
        <Tile icon={Droplet} label="Pesticide not sprayed" value={data.product_litres_saved} decimals={1} suffix=" L" sub="product, est." />
        <Tile icon={IndianRupee} label="Saved (est.)" value={data.cost_saved} prefix="₹" format={inr} sub="product + labour" />
        <Tile icon={Leaf} label="Biocontrol releases" value={data.biocontrol_releases} sub={`predators spared on ${data.predator_protected_days} trap-days`} />
      </div>

      <div className="flex flex-col gap-1.5 text-xs" aria-label="Sprays: calendar vs AgriSense">
        <Bar label="Calendar spraying" value={data.calendar_sprays} max={maxBar} color="bg-slate-500" />
        <Bar label="AgriSense advice" value={data.agrisense_sprays} max={maxBar} color="bg-emerald-400" />
      </div>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer select-none text-slate-700">How this is estimated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Baseline: one spray every {a.calendar_spray_interval_days} days per trap, whatever the pest level.</li>
          <li>
            AgriSense: one spray when a trap turns SPRAY, again if it is still SPRAY after {a.spray_reapply_days} days; WAIT and
            RELEASE BIOCONTROL days are not sprayed.
          </li>
          <li>
            Each trap stands for {a.area_per_trap_acres} acre; {a.product_litres_per_acre_per_spray} L of product and ₹
            {inr(a.cost_per_acre_per_spray)} (product + labour) per acre per spray.
          </li>
          <li className="text-amber-800">{a.placeholder}. Not a measured result.</li>
        </ul>
      </details>
    </section>
  );
}

function Tile({ icon: Icon, label, value, sub, accent = 'text-slate-900', decimals = 0, prefix = '', suffix = '', format }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>
        {format ? `${prefix}${format(value)}${suffix}` : <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={suffix} />}
      </div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </motion.div>
  );
}

function Bar({ label, value, max, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <motion.div className={`h-full rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${(value / max) * 100}%` }} transition={{ duration: 0.6, ease: EASE }} />
      </div>
      <span className="w-16 text-right tabular-nums text-slate-800">{value} sprays</span>
    </div>
  );
}
