import { decisionStyle } from '../lib/decision.js';
import { useT } from '../lib/i18n.jsx';

const SIZES = {
  sm: 'gap-1 px-2 py-0.5 text-[11px]',
  md: 'gap-1.5 px-2.5 py-1 text-xs',
  lg: 'gap-2 px-3.5 py-1.5 text-sm',
};

/** Traffic-light decision pill: shape + colour + words (never colour alone). */
export default function DecisionBadge({ decision, borderline = false, size = 'md', className = '' }) {
  const t = useT();
  const s = decisionStyle(decision);
  if (!s) return null;
  const label = t(`decision.${decision}`);
  return (
    <span
      title={t(`decision.help.${decision}`)}
      aria-label={`Decision: ${label}${borderline ? ' (borderline)' : ''}`}
      data-decision={decision}
      className={`inline-flex items-center whitespace-nowrap rounded-full font-bold tracking-wide ring-1 ${s.pill} ${SIZES[size]} ${className}`}
    >
      <span aria-hidden="true" style={{ color: s.color }}>
        {s.shape}
      </span>
      {label}
      {borderline && (
        <span aria-hidden="true" className="ml-0.5 rounded-sm bg-black/25 px-1 text-[0.8em] font-semibold text-amber-200">
          {t('borderline')}
        </span>
      )}
    </span>
  );
}
