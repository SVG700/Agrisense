/**
 * One list of "what happened" for a trap: captures, farmer actions and advice
 * changes, oldest first. Used by Recent Updates (and filterable by day).
 */
import { decisionStyle } from './decision.js';
import { hasCounts, totalOf } from './pests.js';

const ACTION_LABELS = { sprayed: 'Sprayed', released: 'Released biocontrol', not_yet: 'Not yet' };

export function buildEvents(telemetry, actions, { day } = {}) {
  const ev = [];
  let prevDecision = null;
  for (const row of telemetry) {
    const d = row.detection?.ai_advisory?.decision?.decision ?? null;
    if (!day || row.timestamp.slice(0, 10) === day) {
      ev.push({
        id: `c-${row.id}`,
        at: new Date(row.timestamp),
        kind: 'capture',
        title: hasCounts(row.detection) ? `${totalOf(row.detection.pest_counts)} insects counted` : 'Capture',
        tag: d,
        captureId: row.id,
      });
      if (prevDecision && d && d !== prevDecision) {
        ev.push({ id: `d-${row.id}`, at: new Date(new Date(row.timestamp).getTime() + 1), kind: 'change', title: `Advice → ${decisionStyle(d)?.label ?? d}`, tag: d, captureId: row.id });
      }
    }
    if (d) prevDecision = d;
  }
  for (const a of Array.isArray(actions) ? actions : []) {
    if (day && String(a.acted_at).slice(0, 10) !== day) continue;
    ev.push({ id: `a-${a.id}`, at: new Date(a.acted_at), kind: 'action', title: ACTION_LABELS[a.action] ?? a.action, action: a.action, note: a.note });
  }
  return ev.sort((a, b) => a.at - b.at);
}
