import { useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity } from 'lucide-react';
import { LayoutGroup, motion } from 'framer-motion';
import { PESTS, hasCounts, totalOf } from '../lib/pests.js';
import { ACTION_TYPES } from './ActionLogCard.jsx';

/** Shared Recharts animation: one smooth draw, no bounce. */
const ANIM = { isAnimationActive: true, animationDuration: 900, animationEasing: 'ease-out' };

/**
 * Temperature & humidity (left axis) against pest counts (right axis) over time,
 * so microclimate spikes can be visually correlated with population surges.
 * Logged actions (Sprayed / Released / Not yet) appear as labelled markers at the
 * capture they followed, so the effect of a spray or release is visible.
 */
export default function MicroclimateChart({ telemetry, actions = [] }) {
  const [mode, setMode] = useState('total'); // total | species

  // Polls return a new array every few seconds; only rebuild (and re-animate) when captures change
  const signature = telemetry.map((t) => `${t.id}:${t.detection?.id ?? ''}`).join(',');
  const data = useMemo(
    () =>
      telemetry.map((t) => ({
        time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        ts: Date.parse(t.timestamp),
        // null = not measured / not counted: the chart leaves a gap instead of plotting a fake zero
        temperature: t.temperature === null ? null : Number(t.temperature.toFixed(1)),
        humidity: t.humidity === null ? null : Number(t.humidity.toFixed(1)),
        total: hasCounts(t.detection) ? totalOf(t.detection.pest_counts) : null,
        ...(hasCounts(t.detection) ? t.detection.pest_counts ?? {} : {}),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]
  );

  // One marker per capture slot: the last capture at or before each action (same-slot actions are merged)
  const markers = useMemo(() => {
    if (data.length < 2) return [];
    const bySlot = new Map();
    for (const a of actions) {
      const at = Date.parse(a.acted_at);
      if (!(at >= data[0].ts) || at > data.at(-1).ts + 86_400_000) continue;
      let idx = 0;
      for (let i = 0; i < data.length && data[i].ts <= at; i++) idx = i;
      const slot = bySlot.get(idx) ?? { x: data[idx].time, kinds: [] };
      if (!slot.kinds.includes(a.action)) slot.kinds.push(a.action);
      bySlot.set(idx, slot);
    }
    return [...bySlot.values()];
  }, [actions, data]);

  const correlation = useMemo(() => {
    const pairs = data.filter((d) => d.humidity !== null && d.total !== null);
    return pearson(pairs.map((d) => d.humidity), pairs.map((d) => d.total));
  }, [data]);

  return (
    <section className="card card-hover flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Activity className="h-4 w-4" />
            </span>
            Microclimate vs Pest Population
          </h2>
          {correlation !== null && (
            <p className="mt-2 text-xs text-slate-400">
              Humidity ↔ trap count correlation:{' '}
              <span className={`rounded-md px-1.5 py-0.5 font-mono ring-1 ${Math.abs(correlation) > 0.5 ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30' : 'bg-slate-800 text-slate-200 ring-slate-700'}`}>
                r = {correlation.toFixed(2)}
              </span>
            </p>
          )}
        </div>
        <LayoutGroup id="chart-mode">
          <div className="inline-flex rounded-xl bg-slate-800/80 p-1 text-xs ring-1 ring-slate-700">
            {['total', 'species'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`relative rounded-lg px-3 py-1 capitalize transition-colors duration-200 ${mode === m ? 'text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {mode === m && (
                  <motion.span layoutId="chart-mode-pill" className="absolute inset-0 rounded-lg bg-emerald-400" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                )}
                <span className="relative">{m}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
      </div>

      <div className="h-80">
        {data.length < 2 ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-slate-700/80 text-sm text-slate-500">
            Need at least two captures to draw trends.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="hum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={11} minTickGap={24} />
              <YAxis yAxisId="env" stroke="#64748b" fontSize={11} domain={[0, 100]} />
              <YAxis yAxisId="pests" orientation="right" stroke="#64748b" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'rgb(2 6 23 / 0.92)', border: '1px solid rgb(52 211 153 / 0.25)', borderRadius: 12, fontSize: 12, boxShadow: '0 12px 30px -12px rgb(0 0 0 / 0.7)' }}
                cursor={{ fill: 'rgb(52 211 153 / 0.06)' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />

              {mode === 'total' ? (
                <Bar yAxisId="pests" dataKey="total" name="Insects trapped" fill="#a3e635" fillOpacity={0.55} radius={[6, 6, 0, 0]} {...ANIM} />
              ) : (
                Object.entries(PESTS).map(([key, p]) => (
                  <Bar key={key} yAxisId="pests" dataKey={key} name={p.name} stackId="s" fill={p.color} fillOpacity={0.7} {...ANIM} />
                ))
              )}

              <Area yAxisId="env" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#38bdf8" fill="url(#hum)" strokeWidth={2} {...ANIM} />
              {markers.map((m) => {
                const t = ACTION_TYPES[m.kinds[0]] ?? ACTION_TYPES.not_yet;
                const label = m.kinds.map((k) => (ACTION_TYPES[k] ?? ACTION_TYPES.not_yet).label.split(' ')[0]).join(' + ');
                return (
                  <ReferenceLine
                    key={m.x}
                    yAxisId="env"
                    x={m.x}
                    stroke={t.color}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    label={{ value: label, position: 'insideTopLeft', fill: t.color, fontSize: 11, fontWeight: 700 }}
                  />
                );
              })}
              <Line yAxisId="env" type="monotone" dataKey="temperature" name="Temperature (°C)" stroke="#f97316" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} {...ANIM} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {markers.length > 0 && (
        <p className="flex flex-wrap gap-3 text-[11px] text-slate-400" data-testid="chart-action-legend">
          Your actions:
          {Object.entries(ACTION_TYPES).map(([k, t]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-0.5" style={{ background: t.color }} /> {t.label}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/** Pearson correlation coefficient, or null when undefined. */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
