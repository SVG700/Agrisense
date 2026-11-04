import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Camera, Droplets, Hourglass, Leaf, TriangleAlert } from 'lucide-react';
import { decisionStyle } from '../lib/decision.js';
import { hasCounts, totalOf } from '../lib/pests.js';
import { useT } from '../lib/i18n.jsx';

const ACTION_META = {
  sprayed: { icon: Droplets, label: 'Sprayed', tone: 'bg-rose-500' },
  released: { icon: Leaf, label: 'Released biocontrol', tone: 'bg-amber-500' },
  not_yet: { icon: Hourglass, label: 'Not yet', tone: 'bg-slate-400' },
};
const SPRING = { type: 'spring', stiffness: 260, damping: 30 };

/**
 * The day of the shown capture as a timeline (reference: "Daily Timeline"):
 * captures, farmer actions and advice changes placed at their real time,
 * on lanes so pills never overlap. Scrolls sideways on small screens.
 */
export default function DailyTimeline({ telemetry, actions, capture, onSelectCapture }) {
  const t = useT();
  const reduce = useReducedMotion();
  const day = (capture?.timestamp ?? new Date().toISOString()).slice(0, 10);

  const { events, startH, endH } = useMemo(() => {
    const ev = [];
    let prevDecision = null;
    for (const row of telemetry) {
      const d = row.detection?.ai_advisory?.decision?.decision ?? null;
      if (row.timestamp.slice(0, 10) === day) {
        ev.push({
          id: `c-${row.id}`,
          at: new Date(row.timestamp),
          kind: 'capture',
          title: hasCounts(row.detection) ? `${totalOf(row.detection.pest_counts)} insects` : 'Capture',
          tag: d,
          captureId: row.id,
        });
        if (prevDecision && d && d !== prevDecision) {
          ev.push({ id: `d-${row.id}`, at: new Date(new Date(row.timestamp).getTime() + 1), kind: 'change', title: `Advice → ${decisionStyle(d)?.label ?? d}`, tag: d });
        }
      }
      if (d) prevDecision = d;
    }
    for (const a of Array.isArray(actions) ? actions : []) {
      if (String(a.acted_at).slice(0, 10) !== day) continue;
      ev.push({ id: `a-${a.id}`, at: new Date(a.acted_at), kind: 'action', title: ACTION_META[a.action]?.label ?? a.action, action: a.action, note: a.note });
    }
    ev.sort((a, b) => a.at - b.at);
    // Window around the events (at least 8 h, whole hours, within the day)
    const hours = ev.map((e) => e.at.getHours() + e.at.getMinutes() / 60);
    let s = Math.floor(Math.min(...hours, 24) - 1);
    let e = Math.ceil(Math.max(...hours, 0) + 1);
    while (e - s < 8) (s -= 1), (e += 1);
    if (s < 0) (e -= s), (s = 0);
    if (e > 24) (s = Math.max(0, s - (e - 24))), (e = 24);
    // Greedy lanes: a pill takes about a fifth of the window
    const width = (e - s) / 5;
    const lanes = [];
    for (const item of ev) {
      const h = item.at.getHours() + item.at.getMinutes() / 60;
      let lane = lanes.findIndex((end) => end <= h);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = h + width;
      item.lane = lane;
      item.h = h;
    }
    return { events: ev, startH: s, endH: e };
  }, [telemetry, actions, day]);

  const span = endH - startH;
  const hourTicks = [];
  for (let h = startH; h <= endH; h += span > 12 ? 2 : 1) hourTicks.push(h);
  const lanes = Math.max(1, ...events.map((e) => e.lane + 1));
  const fmtHour = (h) => new Date(2000, 0, 1, h % 24).toLocaleTimeString([], { hour: 'numeric' });
  const pos = (h) => `${((h - startH) / span) * 100}%`;
  const dateLabel = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <section className="card overflow-hidden p-0!" aria-labelledby="timeline-title">
      <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
        <h2 id="timeline-title" className="text-lg font-semibold tracking-tight text-ink">
          {t('timeline.title')}
        </h2>
        <span className="h-4 w-px bg-line" aria-hidden="true" />
        <span className="text-sm text-slate-500">
          {dateLabel} · {t('timeline.count', { n: events.length })}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="px-6 pb-6 pt-3 text-sm text-slate-500">{t('timeline.empty')}</p>
      ) : (
        <div className="snap-rail overflow-x-auto px-6 pb-6">
          <div className="relative min-w-[760px] pt-4" style={{ height: 40 + lanes * 56 }}>
            {/* hour grid */}
            {hourTicks.map((h) => (
              <div key={h} className="absolute bottom-0 top-0" style={{ left: pos(h) }} aria-hidden="true">
                <span className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-slate-500">{fmtHour(h)}</span>
                <span className="absolute bottom-0 top-6 w-px bg-line" />
              </div>
            ))}
            <ol className="absolute inset-x-0 bottom-0 top-8" aria-label={t('timeline.title')}>
              {events.map((e, i) => (
                <motion.li
                  key={e.id}
                  className="absolute"
                  style={{ left: pos(e.h), top: e.lane * 56, translate: (e.h - startH) / span > 0.6 ? '-100% 0' : undefined }}
                  initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...SPRING, delay: reduce ? 0 : i * 0.03 }}
                >
                  <EventPill event={e} selected={e.captureId && e.captureId === capture?.id} onSelectCapture={onSelectCapture} />
                </motion.li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

function EventPill({ event: e, selected, onSelectCapture }) {
  const dec = decisionStyle(e.tag);
  const Icon = e.kind === 'action' ? ACTION_META[e.action]?.icon ?? Droplets : e.kind === 'change' ? TriangleAlert : Camera;
  const time = e.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const body = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
      <span className="whitespace-nowrap text-ink">{e.title}</span>
      {e.kind === 'action' ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
          <span className={`h-1.5 w-1.5 rounded-full ${ACTION_META[e.action]?.tone ?? 'bg-slate-400'}`} aria-hidden="true" />
          {time}
        </span>
      ) : (
        dec && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            <span aria-hidden="true" style={{ color: dec.color }}>
              {dec.shape}
            </span>
            {time}
          </span>
        )
      )}
    </>
  );
  const cls = `flex min-h-11 items-center gap-2.5 rounded-full bg-surface py-1.5 pl-3 pr-1.5 text-sm shadow-[var(--elev-2)] ring-1 transition-[box-shadow,transform] duration-300 ${
    selected ? 'ring-brand' : 'ring-line'
  }`;
  return e.captureId ? (
    <button type="button" className={`${cls} hover:-translate-y-0.5 hover:shadow-[var(--elev-3)]`} onClick={() => onSelectCapture?.(e.captureId)} aria-pressed={selected} title={e.note ?? undefined}>
      {body}
    </button>
  ) : (
    <div className={cls} title={e.note ?? undefined}>
      {body}
    </div>
  );
}
