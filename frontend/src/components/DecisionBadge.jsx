import { decisionStyle } from '../lib/decision.js';

const SIZES = {
  sm: 'gap-1 px-2 py-0.5 text-[11px]',
  md: 'gap-1.5 px-2.5 py-1 text-xs',
  lg: 'gap-2 px-3.5 py-1.5 text-sm',
};

/** Traffic-light decision pill: shape + colour + words (never colour alone). */
export default function DecisionBadge({ decision, borderline = false, size = 'md', className = '' }) {
  const s = decisionStyle(decision);
  if (!s) return null;
  return (
    <span
      title={s.help}
      aria-label={`Decision: ${s.label}${borderline ? ' (borderline)' : ''}`}
      data-decision={decision}
      className={`inline-flex items-center whitespace-nowrap rounded-full font-bold tracking-wide ring-1 ${s.pill} ${SIZES[size]} ${className}`}
    >
      <span aria-hidden="true" style={{ color: s.color }}>
        {s.shape}
      </span>
      {s.label}
      {borderline && (
        <span aria-hidden="true" className="ml-0.5 rounded-sm bg-black/25 px-1 text-[0.8em] font-semibold text-amber-200">
          BORDERLINE
        </span>
      )}
    </span>
  );
}
