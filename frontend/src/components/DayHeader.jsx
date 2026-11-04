import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CircleCheck, ScanSearch, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import DecisionBadge from './DecisionBadge.jsx';
import { decisionReason, useT } from '../lib/i18n.jsx';
import { haptic } from '../lib/theme.js';

const SPRING = { type: 'spring', stiffness: 320, damping: 32 };
const SWIPE_PX = 48;

/**
 * Page header in the reference's layout: "Your field today" + headline, a
 * status tile, Customize; then the day strip that steps through captures
 * (arrows, keyboard ← →, or a swipe on the strip itself).
 */
export default function DayHeader({ headline, decision, device, capture, index, count, onStep, onCustomize, onAsk }) {
  const t = useT();
  const reduce = useReducedMotion();
  const action = decision?.decision === 'SPRAY' || decision?.decision === 'BIOCONTROL' || decision?.decision === 'CHECK_TRAP';
  const date = capture ? new Date(capture.timestamp) : new Date();
  const canPrev = index > 0;
  const canNext = index < count - 1;
  const step = (dir) => {
    if ((dir < 0 && !canPrev) || (dir > 0 && !canNext)) return;
    haptic();
    onStep(dir);
  };

  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{t('day.kicker', { trap: device?.name ?? '—' })}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink sm:text-[2.5rem] sm:leading-[1.1]">{headline}</h1>
        </div>

        <div className="hidden h-12 w-px bg-line lg:block" aria-hidden="true" />

        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-[var(--elev-2)] ring-1 ring-line ${
              action ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'
            }`}
            aria-hidden="true"
          >
            {action ? <TriangleAlert className="h-5 w-5" /> : <CircleCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-ink">{action ? t('day.actionTitle') : t('day.okTitle')}</p>
            <p className="line-clamp-2 text-xs text-slate-500">{decision ? decisionReason(t.lang, decision) : t('day.okSub')}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
          <button type="button" onClick={onAsk} className="btn btn-ghost">
            <ScanSearch className="h-4 w-4" aria-hidden="true" /> {t('day.ask')}
          </button>
          <button type="button" onClick={onCustomize} className="btn btn-primary">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {t('day.customize')}
          </button>
        </div>
      </div>

      {/* Day strip: swipe left/right (touch), arrows, or ← → keys */}
      <motion.div
        role="group"
        aria-label={t('day.stripAria')}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (info.offset.x <= -SWIPE_PX) step(1);
          else if (info.offset.x >= SWIPE_PX) step(-1);
        }}
        transition={SPRING}
        className="flex touch-pan-y items-center gap-4 border-y border-line py-3 outline-offset-4"
      >
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface text-center leading-none shadow-[var(--elev-1)] ring-1 ring-line">
          <span className="text-base font-semibold text-ink">{date.getDate()}</span>
          <span className="text-[10px] text-slate-500">{date.toLocaleDateString(undefined, { month: 'short' })}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
            {count ? (
              <>
                {t('day.capture')} <b className="text-ink tabular-nums">{index + 1}</b>
                <span className="text-slate-500">/ {count}</span>
                <span className="text-slate-500">· {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </>
            ) : (
              t('status.never')
            )}
          </p>
          {decision?.decision && (
            <div className="mt-1">
              <DecisionBadge decision={decision.decision} borderline={decision.borderline} size="sm" />
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <StepButton label={t('day.prev')} disabled={!canPrev} onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </StepButton>
          <StepButton label={t('day.next')} disabled={!canNext} onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </StepButton>
        </div>
      </motion.div>
    </header>
  );
}

function StepButton({ label, disabled, onClick, children }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-11 w-11 place-items-center rounded-full bg-surface text-ink shadow-[var(--elev-1)] ring-1 ring-line transition-colors hover:bg-slate-100 disabled:opacity-35"
    >
      {children}
    </motion.button>
  );
}
