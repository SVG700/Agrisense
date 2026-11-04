/**
 * Traffic-light styles for the predator-aware decision. Every state has a
 * colour AND a distinct shape (▲ ◆ ● ■) so it reads without colour vision and
 * on a sunlit phone screen. The rule itself lives in the backend
 * (services/decision.js); the frontend only displays it.
 */
export const DECISION_STYLES = {
  SPRAY: {
    label: 'SPRAY',
    shape: '▲',
    color: '#e11d48',
    text: 'text-rose-700',
    pill: 'bg-rose-500/15 text-rose-700 ring-rose-500/50',
    panel: 'bg-rose-500/10 ring-rose-500/30',
    help: 'Pests are above the action level and predators are too few to keep up.',
  },
  BIOCONTROL: {
    label: 'RELEASE BIOCONTROL',
    shape: '◆',
    color: '#d97706',
    text: 'text-amber-800',
    pill: 'bg-amber-500/15 text-amber-800 ring-amber-500/50',
    panel: 'bg-amber-500/10 ring-amber-500/30',
    help: 'Pests are above the action level, but predators are keeping pace: release more instead of spraying.',
  },
  WAIT: {
    label: 'WAIT',
    shape: '●',
    color: '#16a34a',
    text: 'text-emerald-700',
    pill: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/50',
    panel: 'bg-emerald-500/10 ring-emerald-500/30',
    help: 'Pests are below the action level. Keep monitoring.',
  },
  CHECK_TRAP: {
    label: 'CHECK TRAP',
    shape: '■',
    color: '#64748b',
    text: 'text-slate-700',
    pill: 'bg-slate-500/20 text-slate-800 ring-slate-400/50',
    panel: 'bg-slate-500/10 ring-slate-400/30',
    help: 'The trap could not be read (failed or missing photo, or no recent capture). Check it in the field.',
  },
};

export const DECISION_KEYS = Object.keys(DECISION_STYLES);

export const decisionStyle = (decision) => DECISION_STYLES[decision] ?? null;
