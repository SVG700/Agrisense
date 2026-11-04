import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IndianRupee, PiggyBank, RotateCcw, Settings2, ShieldAlert, TrendingDown } from 'lucide-react';
import { api } from '../api.js';
import { AnimatedNumber, EASE } from '../lib/motion.jsx';
import { inr } from '../lib/economics.js';
import Badge from './Badge.jsx';
import DecisionBadge from './DecisionBadge.jsx';
import { useT } from '../lib/i18n.jsx';

const SPRING = { type: 'spring', stiffness: 260, damping: 30 };

/**
 * Economic Impact Engine widget: the rupee value of the trap's current decision.
 * WAIT / BIOCONTROL -> money saved by not spraying; SPRAY -> crop value at risk
 * if ignored, against the spray cost. Always labelled as an estimate; the farm
 * numbers (crop, acres, price, yield, costs) are editable per trap.
 */
export default function EconomicsCard({ device, economics }) {
  const t = useT();
  const { data, settings, setSettings, reset } = economics;
  const [editing, setEditing] = useState(false);
  const s = data?.settings;

  return (
    <section className="card relative overflow-hidden p-0!" aria-labelledby="econ-title" data-testid="economics-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id="econ-title" className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <IndianRupee className="h-4 w-4" aria-hidden="true" />
            </span>
            {t('econ.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t('econ.sub', { trap: device?.name ?? '—' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warn" title={t('econ.estimateHelp')}>
            {t('econ.estimate')}
          </Badge>
          {data?.simulated && <Badge tone="warn">{t('simulatedData')}</Badge>}
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-expanded={editing}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            {s ? `${s.crop_label.split(' (')[0]} · ${s.acres} ${t('econ.acres')}` : t('econ.farm')}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <FarmForm settings={settings} resolved={s} onChange={setSettings} onReset={reset} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-5">
        {!data ? (
          <div className="h-36 animate-pulse rounded-2xl bg-slate-100" />
        ) : data.kind === 'unknown' ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600 ring-1 ring-line">{t('econ.unknown')}</p>
        ) : (
          <motion.div key={`${data.kind}-${data.decision}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
            {data.kind === 'saved' ? <Saved data={data} /> : <AtRisk data={data} />}
            <Breakdown data={data} />
          </motion.div>
        )}
        <p className="mt-4 text-[11px] leading-snug text-slate-500">{t('econ.footnote')}</p>
      </div>
    </section>
  );
}

function Saved({ data }) {
  const t = useT();
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 p-5 ring-1 ring-emerald-200">
      <PiggyBank className="absolute -right-3 -top-3 h-24 w-24 text-emerald-500/15" aria-hidden="true" />
      <div className="flex items-center gap-2">
        <DecisionBadge decision={data.decision} size="sm" />
      </div>
      <p className="mt-3 text-sm font-medium text-emerald-800">{data.decision === 'WAIT' ? t('econ.avoided') : t('econ.replaced')}</p>
      <p className="mt-1 text-4xl font-semibold tracking-tight text-emerald-800 tabular-nums sm:text-5xl" aria-live="polite">
        ₹<AnimatedNumber value={data.headline_inr} grouping />
      </p>
      <p className="text-sm text-emerald-800">{t('econ.savedToday')}</p>
      <p className="mt-3 text-xs leading-relaxed text-emerald-800/90">{data.why}</p>
    </div>
  );
}

function AtRisk({ data }) {
  const t = useT();
  const max = Math.max(data.headline_inr, data.spray_cost_inr, 1);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 p-5 ring-1 ring-rose-200">
      <ShieldAlert className="absolute -right-3 -top-3 h-24 w-24 text-rose-500/15" aria-hidden="true" />
      <DecisionBadge decision={data.decision} size="sm" />
      <p className="mt-3 text-sm font-medium text-rose-800">{t('econ.atRisk')}</p>
      <p className="mt-1 text-4xl font-semibold tracking-tight text-rose-800 tabular-nums sm:text-5xl" aria-live="polite">
        ₹<AnimatedNumber value={data.headline_inr} grouping />
      </p>
      <p className="text-sm text-rose-800">{t('econ.overDays', { n: data.settings.horizon_days, pct: data.loss_pct })}</p>

      {/* spraying cost vs loss avoided */}
      <div className="mt-4 flex flex-col gap-2 text-xs text-rose-900" role="img" aria-label={t('econ.compareAria', { spray: inr(data.spray_cost_inr), loss: inr(data.headline_inr) })}>
        <Bar label={t('econ.sprayCost')} value={inr(data.spray_cost_inr)} pct={(data.spray_cost_inr / max) * 100} tone="bg-rose-300" />
        <Bar label={t('econ.lossIfIgnored')} value={inr(data.headline_inr)} pct={(data.headline_inr / max) * 100} tone="bg-rose-600" />
      </div>
      {data.return_per_rupee !== null && (
        <p className="mt-3 text-sm font-semibold text-rose-900">
          <TrendingDown className="mr-1 inline h-4 w-4" aria-hidden="true" />
          {t('econ.roi', { r: data.return_per_rupee, net: inr(data.net_benefit_inr) })}
        </p>
      )}
    </div>
  );
}

function Bar({ label, value, pct, tone }) {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <b className="tabular-nums">{value}</b>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/70">
        <motion.div className={`h-full rounded-full ${tone}`} initial={{ width: 0 }} animate={{ width: `${Math.max(2, pct)}%` }} transition={{ duration: 0.8, ease: EASE }} />
      </div>
    </div>
  );
}

function Breakdown({ data }) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('econ.how')}</h3>
      <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
        {data.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="text-slate-700">{l.label}</span>
            <span className={`shrink-0 font-semibold tabular-nums ${l.inr < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {l.inr < 0 ? '−' : '+'}
              {inr(Math.abs(l.inr))}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-sm font-semibold">
          <span className="text-ink">{data.kind === 'saved' ? t('econ.totalSaved') : t('econ.netBenefit')}</span>
          <span className="tabular-nums text-ink">{inr(data.kind === 'saved' ? data.headline_inr : data.net_benefit_inr)}</span>
        </li>
      </ul>
    </div>
  );
}

/** Per-trap farm numbers; empty fields use the crop preset / defaults. */
function FarmForm({ settings, resolved, onChange, onReset }) {
  const t = useT();
  const [crops, setCrops] = useState([]);
  useEffect(() => {
    api.crops().then(setCrops).catch(() => setCrops([]));
  }, []);
  const set = (k, v) => onChange({ ...settings, [k]: v === '' ? undefined : v });
  const field = (k, label, unit, placeholder) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      <span className="flex items-center rounded-xl ring-1 ring-line focus-within:ring-2 focus-within:ring-[#c9a227]">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={settings[k] ?? ''}
          placeholder={placeholder != null ? String(placeholder) : ''}
          onChange={(e) => set(k, e.target.value)}
          className="h-10 w-full min-w-0 rounded-xl bg-transparent px-3 text-sm font-normal text-ink outline-none"
        />
        <span className="pr-3 text-[11px] text-slate-500">{unit}</span>
      </span>
    </label>
  );
  return (
    <div className="mx-5 mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-line sm:grid-cols-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        {t('econ.crop')}
        <select value={settings.crop ?? resolved?.crop ?? ''} onChange={(e) => onChange({ ...settings, crop: e.target.value, yield: undefined, price: undefined })} className="field h-10 px-3 text-sm font-normal">
          {crops.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {field('acres', t('econ.area'), t('econ.acres'), resolved?.acres)}
      {field('price', t('econ.price'), '₹/kg', resolved?.price_inr_per_kg)}
      {field('yield', t('econ.yield'), 'kg/acre', resolved?.yield_kg_per_acre)}
      {field('spray_cost', t('econ.sprayCostField'), '₹/acre', resolved?.spray_cost_inr_per_acre)}
      {field('biocontrol_cost', t('econ.bioCostField'), '₹/acre', resolved?.biocontrol_cost_inr_per_acre)}
      <div className="flex items-center justify-between gap-2 sm:col-span-3">
        <p className="text-[11px] text-slate-500">{t('econ.formHelp')}</p>
        <button type="button" onClick={onReset} className="btn btn-ghost min-h-9 shrink-0 px-3 py-1.5 text-xs">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('econ.reset')}
        </button>
      </div>
    </div>
  );
}
