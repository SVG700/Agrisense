import { BrainCircuit, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { motion } from 'framer-motion';
import { RISK_STYLES } from '../lib/pests.js';
import { EASE } from '../lib/motion.jsx';
import Badge from './Badge.jsx';
import DecisionBadge from './DecisionBadge.jsx';
import { decisionStyle } from '../lib/decision.js';

const RISK_ICON = { Low: ShieldCheck, Medium: ShieldQuestion, High: ShieldAlert };

const LLM_NAMES = { gemini: 'Gemini', claude: 'Claude' };

/** Labels exactly where the advice came from - fallback output is never shown as an LLM's. */
function sourceBadge(advisory) {
  if (LLM_NAMES[advisory.source]) {
    return (
      <Badge tone="good">
        {LLM_NAMES[advisory.source]}
        {advisory.model ? ` · ${advisory.model}` : ''}
      </Badge>
    );
  }
  if (advisory.status === 'fallback') {
    // Older records have no error.provider; they were always Claude
    const failed = LLM_NAMES[advisory.error?.provider] ?? 'Claude';
    return (
      <Badge tone="bad" title={advisory.error?.message}>
        Rule engine ({failed} failed: {advisory.error?.code ?? 'error'})
      </Badge>
    );
  }
  if (advisory.source === 'rule-engine' && advisory.status === 'demo') {
    return (
      <Badge tone="warn" title="Seeded demo advisory from the rule engine (no LLM call)">
        Rule engine · demo
      </Badge>
    );
  }
  if (advisory.source === 'rule-engine') return <Badge tone="muted">Rule engine</Badge>;
  return <Badge tone="muted">No advisory</Badge>;
}

/** Prominent widget for the capture's advisory (Claude or rule engine). */
export default function AdvisoryCard({ advisory }) {
  if (!advisory) {
    return (
      <section className="card flex flex-col items-center justify-center gap-3 py-12 text-center text-sm text-slate-500">
        <span className="icon-chip h-12! w-12! animate-pulse rounded-2xl!">
          <BrainCircuit className="h-6 w-6" />
        </span>
        The advisory will appear after the first trap capture.
      </section>
    );
  }

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="card-title">
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <BrainCircuit className="h-4 w-4" />
        </span>
        Agronomic Advisory
      </h2>
      {sourceBadge(advisory)}
    </div>
  );

  // No counts -> no risk assessment (detection failed / not configured / no image)
  if (!RISK_STYLES[advisory.risk_level]) {
    return (
      <section className="card card-hover flex flex-col gap-3">
        {header}
        <p className="flex gap-2 text-sm text-slate-300">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" />
          {advisory.summary || 'No advisory is available for this capture.'}
        </p>
        <DecisionPanel decision={advisory.decision} />
      </section>
    );
  }

  const risk = advisory.risk_level;
  const style = RISK_STYLES[risk];
  const Icon = RISK_ICON[risk];
  const steps = advisory.mitigation_strategy?.length ? advisory.mitigation_strategy : [advisory.recommendation];

  return (
    <section className={`card card-hover ring-1 ${style.ring} flex flex-col gap-4 overflow-hidden`}>
      <div className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${style.bg}`} />
      {header}

      <motion.div
        key={risk}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`relative flex items-center gap-4 rounded-2xl ${style.bg} p-4 ring-1 ring-white/5`}
      >
        <Icon className={`h-12 w-12 shrink-0 ${style.text}`} />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-widest text-slate-400">Estimated outbreak risk</div>
          <div className={`text-3xl font-extrabold ${style.text}`}>{risk}</div>
          {advisory.confidence && (
            <div className="text-xs text-slate-400">Evidence confidence: {advisory.confidence}</div>
          )}
          <RiskMeter risk={risk} />
        </div>
        {risk === 'High' && <span className={`live-dot ml-auto self-start ${style.text}`} />}
      </motion.div>

      <DecisionPanel decision={advisory.decision} />

      {advisory.summary && <p className="text-sm text-slate-300">{advisory.summary}</p>}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Suggested actions</div>
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: 0.15 + i * 0.07 }}
              className="flex gap-3 rounded-lg p-1 text-sm transition-colors duration-200 hover:bg-white/[0.03]"
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${style.bg} ${style.text}`}>
                {i + 1}
              </span>
              <span className="text-slate-200">{step}</span>
            </motion.li>
          ))}
        </ol>
      </div>

      <p className="text-[11px] leading-snug text-slate-500">
        Decision support only - based on automated trap counts, not a verified diagnosis. Confirm by scouting the crop and
        follow product labels and local extension advice.
        {advisory.generated_at && <> · Generated {new Date(advisory.generated_at).toLocaleTimeString()}</>}
      </p>
    </section>
  );
}

/** The predator-aware rule's decision that the advisory explains (older captures have none). */
export function DecisionPanel({ decision }) {
  const style = decisionStyle(decision?.decision);
  if (!style) return null;
  const [lo, hi] = decision.range?.pests ?? [];
  return (
    <motion.div
      key={decision.decision}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`rounded-xl p-3 ring-1 ${style.panel}`}
      data-testid="decision-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-slate-400">Decision</span>
        <DecisionBadge decision={decision.decision} borderline={decision.borderline} size="lg" />
      </div>
      <p className="mt-2 text-sm text-slate-300">{decision.reason}</p>
      {decision.check_trap ? (
        decision.last_counted && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            Last counted advice: <DecisionBadge decision={decision.last_counted.decision} size="sm" />
          </p>
        )
      ) : (
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          Avg {decision.avg_pests} pests/day
          {lo !== undefined && ` (range ${lo}-${hi})`}
        </span>
        <span>
          {decision.no_predators ? 'No predators seen' : `${decision.pests_per_predator} pests per predator`}
        </span>
        <span>
          {decision.window?.days} of {decision.window?.requested} days
        </span>
        <span title="Thresholds are placeholders until confirmed with the ICAR-IIHR mentor">
          Thresholds: {decision.thresholds?.action_threshold_per_day}/day, ratio {decision.thresholds?.spray_ratio} (placeholder)
        </span>
      </div>
      )}
    </motion.div>
  );
}

const LEVELS = ['Low', 'Medium', 'High'];

/** Three-segment meter that fills up to the current risk level. */
function RiskMeter({ risk }) {
  const level = LEVELS.indexOf(risk);
  return (
    <div className="mt-2 flex max-w-48 gap-1.5" aria-hidden="true">
      {LEVELS.map((l, i) => (
        <div key={l} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700/60">
          <motion.div
            className={`h-full rounded-full ${RISK_STYLES[risk].dot}`}
            initial={{ width: 0 }}
            animate={{ width: i <= level ? '100%' : 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.2 + i * 0.12 }}
          />
        </div>
      ))}
    </div>
  );
}
