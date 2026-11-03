/**
 * Demo mode: four DEMO traps with 14 days of SIMULATED captures, built so the
 * predator-aware decision shows every traffic-light state:
 *
 *   Polyhouse 1 (tomato)    whitefly climbing, almost no predators  -> SPRAY
 *   Polyhouse 2 (tomato)    whitefly high, Macrolophus/Nesidiocoris
 *                           build up and catch up                    -> RELEASE BIOCONTROL
 *   Net-house (capsicum)    hovering just under the action level     -> WAIT (BORDERLINE)
 *   Polyhouse 3 (cucumber)  last photo unreadable                    -> CHECK TRAP
 *
 * Nothing here pretends to be real: every capture is data_source "simulator",
 * detections come from the "demo-detector" (synthetic trap images whose boxes
 * are generated, not inferred), and advisories are the rule engine labelled
 * status "demo" (no LLM calls, no cost). Captures go through the same store
 * write as real ones, so the dashboard, map and decision API treat them alike.
 */
import { randomUUID } from 'node:crypto';
import { ruleBasedAdvisory } from './advisor.js';
import { evaluateDecision, splitCounts, withTrapCheck } from './decision.js';
import { hashSeed } from './mockTrap.js';

export const DEMO_DAYS = 14;

/** Fixed ids so a reset replaces the same traps. */
export const DEMO_TRAPS = [
  {
    id: 'd3e00000-0000-4000-8000-000000000001',
    name: 'DEMO · Polyhouse 1 (tomato)',
    latitude: 13.1352,
    longitude: 77.4846,
    battery_level: 88,
    // whitefly builds up fast; predators almost absent
    curve: (t) => ({ density: 0.12 + 1.05 * t ** 1.6, predators: 0.02 }),
  },
  {
    id: 'd3e00000-0000-4000-8000-000000000002',
    name: 'DEMO · Polyhouse 2 (tomato)',
    latitude: 13.1411,
    longitude: 77.4952,
    battery_level: 74,
    // pressure as high, but released predators establish and catch up
    curve: (t) => ({ density: 0.15 + 0.85 * t, predators: 0.03 + 0.17 * t }),
  },
  {
    id: 'd3e00000-0000-4000-8000-000000000003',
    name: 'DEMO · Net-house (capsicum)',
    latitude: 13.1286,
    longitude: 77.4771,
    battery_level: 63,
    // stays just below the action level (25/day): pinned to target counts so it is reliably BORDERLINE
    curve: (t, i) => ({ density: 0.29, predators: 0.05, targetPests: 22 + Math.round(Math.sin(i * 1.3)) }),
  },
  {
    id: 'd3e00000-0000-4000-8000-000000000004',
    name: 'DEMO · Polyhouse 3 (cucumber)',
    latitude: 13.1462,
    longitude: 77.4705,
    battery_level: 41,
    curve: (t) => ({ density: 0.45 + 0.45 * t, predators: 0.03 }),
    // the final photo could not be read (fogged lens) -> CHECK TRAP
    failLast: true,
  },
];

export const DEMO_TRAP_IDS = DEMO_TRAPS.map((t) => t.id);

// Capture times: 08:00 and 17:00 IST
const SLOTS_UTC = ['02:30:00.000Z', '11:30:00.000Z'];
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const jitter = (key, spread) => ((hashSeed(key) % 1000) / 1000 - 0.5) * 2 * spread;
const round1 = (n) => Math.round(n * 10) / 10;

/** Every planned capture for one trap, oldest first (no future timestamps). */
function planCaptures(trap, now) {
  const plan = [];
  for (let back = DEMO_DAYS - 1; back >= 0; back--) {
    const date = isoDay(now - back * 86_400_000);
    const i = DEMO_DAYS - 1 - back;
    const t = i / (DEMO_DAYS - 1);
    SLOTS_UTC.forEach((slot, s) => {
      const timestamp = `${date}T${slot}`;
      if (Date.parse(timestamp) > now) return;
      const { density, predators, targetPests } = trap.curve(t, i);
      const key = `${trap.id}-${date}-${s}`;
      plan.push({
        timestamp,
        seed: `demo-${hashSeed(key).toString(36)}`,
        density: Math.max(0.05, density * (s === 0 ? 0.85 : 1) + jitter(key, 0.04)),
        predators: Math.max(0, predators + jitter(`${key}p`, 0.015)),
        targetPests,
        // warm, humid afternoons; cooler, damper mornings
        temperature: round1((s === 0 ? 23.5 : 30) + jitter(`${key}t`, 1.5)),
        humidity: round1((s === 0 ? 84 : 66) + jitter(`${key}h`, 5)),
      });
    });
  }
  if (trap.failLast && plan.length) plan.at(-1).fail = true;
  return plan;
}

/** Builds one stored capture (telemetry + detection) exactly as ingestion would. */
const trapUrl = (publicUrl, seed, step) =>
  `${publicUrl}/api/mock-trap/${seed}.svg?d=${step.density.toFixed(3)}&m=wf&p=${step.predators.toFixed(3)}`;

/**
 * Runs the demo detector on the step's synthetic card. With a target count,
 * tries seed variants (still deterministic) and keeps the closest card.
 */
async function detectStep(step, vision, publicUrl) {
  let best = null;
  const tries = step.targetPests === undefined ? 1 : 40;
  for (let k = 0; k < tries; k++) {
    const imageUrl = trapUrl(publicUrl, k ? `${step.seed}-${k}` : step.seed, step);
    const result = await vision.detect({ imageUrl, image: null });
    const miss = step.targetPests === undefined ? 0 : Math.abs(splitCounts(result.counts).pests - step.targetPests);
    if (!best || miss < best.miss) best = { imageUrl, result, miss };
    if (miss <= 1) break;
  }
  return best;
}

async function buildCapture({ trap, step, vision, config, days, history, publicUrl }) {
  const detected = step.fail ? null : await detectStep(step, vision, publicUrl);
  const imageUrl = detected?.imageUrl ?? trapUrl(publicUrl, step.seed, step);
  const telemetry = {
    device_id: trap.id,
    capture_id: randomUUID(),
    timestamp: step.timestamp,
    temperature: step.temperature,
    humidity: step.humidity,
    image_url: imageUrl,
    image_path: null,
    data_source: 'simulator',
  };
  const generated_at = step.timestamp;

  if (step.fail) {
    const decision = withTrapCheck(evaluateDecision(days), {
      status: 'failed',
      timestamp: step.timestamp,
      reason: 'The latest trap photo could not be read (demo: fogged camera lens). Wipe the lens and photograph the card again.',
    });
    return {
      telemetry,
      detection: {
        pest_counts: {},
        bounding_boxes: [],
        ai_advisory: {
          risk_level: null,
          confidence: null,
          summary: 'Demo: the latest trap photo was too blurry to count, so no advisory was generated. The capture and readings were saved.',
          recommendation: '',
          mitigation_strategy: [],
          source: 'none',
          status: 'skipped',
          generated_at,
          decision,
        },
        vision_meta: {
          status: 'failed',
          source: 'simulated',
          provider: 'demo-detector',
          model: 'synthetic-v1',
          image: null,
          rejected: 0,
          error: { code: 'image_unreadable', message: 'Demo: simulated unreadable photo (fogged lens)' },
          latency_ms: null,
        },
      },
    };
  }

  const { result } = detected;
  const counted = result.boxes.filter((b) => b.confidence >= config.vision.minConfidence);
  const confs = counted.map((b) => b.confidence);
  const meanConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  const date = step.timestamp.slice(0, 10);
  const { pests, predators } = splitCounts(result.counts);
  const prev = days.find((d) => d.date === date);
  if (!prev) days.push({ date, pests, predators, confidence: meanConfidence });
  else if (pests > prev.pests) Object.assign(prev, { pests, predators, confidence: meanConfidence });
  const decision = evaluateDecision(days);

  const advisory = ruleBasedAdvisory({
    pest_counts: result.counts,
    temperature: step.temperature,
    humidity: step.humidity,
    history: history.slice(-6),
    detection: { simulated: true, mean_confidence: meanConfidence },
    decision,
  });
  history.push({ time: step.timestamp, total: Object.values(result.counts).reduce((a, b) => a + b, 0), temperature: step.temperature, humidity: step.humidity });

  return {
    telemetry,
    detection: {
      pest_counts: result.counts,
      bounding_boxes: result.boxes,
      ai_advisory: { ...advisory, source: 'rule-engine', status: 'demo', generated_at, decision },
      vision_meta: {
        status: 'simulated',
        source: 'simulated',
        provider: 'demo-detector',
        model: result.model,
        image: result.image,
        rejected: 0,
        error: null,
        latency_ms: null,
      },
    },
  };
}

/**
 * Deletes the demo traps (and everything under them) and seeds them again,
 * ending at `now`.
 * @returns {{traps: {id, name, captures, decision, label, borderline}[], captures: number}}
 */
export async function resetDemo({ store, vision, config, publicUrl, now = Date.now() }) {
  await store.deleteDevices(DEMO_TRAP_IDS);
  await store.upsertDevices(
    DEMO_TRAPS.map(({ id, name, latitude, longitude, battery_level }) => ({
      id,
      name,
      latitude,
      longitude,
      battery_level,
      status: 'online',
      // Shown on the dashboard (unlike map-only simulated traps); every capture is labelled simulated instead
      simulated: false,
    }))
  );

  const plannedActions = [];
  const traps = await Promise.all(
    DEMO_TRAPS.map(async (trap) => {
      const days = [];
      const history = [];
      const stored = [];
      for (const step of planCaptures(trap, now)) {
        const capture = await buildCapture({ trap, step, vision, config, days, history, publicUrl });
        await store.ingestCapture(capture);
        stored.push(capture);
      }
      const last = stored.at(-1)?.detection.ai_advisory.decision;
      plannedActions.push(...demoActions(trap, stored));
      return {
        id: trap.id,
        name: trap.name,
        captures: stored.length,
        decision: last?.decision ?? null,
        label: last?.label ?? null,
        borderline: Boolean(last?.borderline),
      };
    })
  );
  // The action log needs schema v4; without it the demo still works, just without actions
  let actions = 0;
  try {
    if (plannedActions.length) actions = (await store.addActions(plannedActions)).length;
  } catch {
    actions = null;
  }
  return { traps, captures: traps.reduce((n, t) => n + t.captures, 0), days: DEMO_DAYS, actions };
}

/**
 * A believable farmer response for the story: Polyhouse 1 hesitates on its first
 * SPRAY ("not yet" - waiting for dry weather), Polyhouse 2 releases predators when
 * it first turns RELEASE BIOCONTROL. Logged a few hours after the capture.
 */
function demoActions(trap, stored) {
  const first = (decision) => stored.find((c) => c.detection.ai_advisory.decision?.decision === decision);
  const at = (c, hours) => new Date(Date.parse(c.telemetry.timestamp) + hours * 3_600_000).toISOString();
  const out = [];
  if (trap.id === DEMO_TRAPS[0].id) {
    const c = first('SPRAY');
    if (c) out.push({ device_id: trap.id, action: 'not_yet', decision: 'SPRAY', note: 'Demo: waiting for a dry morning to spray', acted_at: at(c, 2) });
  }
  if (trap.id === DEMO_TRAPS[1].id) {
    const c = first('BIOCONTROL');
    if (c) out.push({ device_id: trap.id, action: 'released', decision: 'BIOCONTROL', note: 'Demo: released Macrolophus', acted_at: at(c, 3) });
  }
  return out.filter((a) => Date.parse(a.acted_at) <= Date.now());
}

/** Removes the demo traps and their captures. */
export async function clearDemo({ store }) {
  const removed = await store.deleteDevices(DEMO_TRAP_IDS);
  return { removed: removed.length };
}

/** Exposed for tests. */
export const _internals = { planCaptures };
