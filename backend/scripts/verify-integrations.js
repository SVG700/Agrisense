/**
 * Manual live-integration checks (uses REAL credentials from backend/.env).
 * Never run by `npm test`.
 *
 *   npm run verify:gemini                     # free: confirms GEMINI_MODEL exists for your key
 *   npm run verify:gemini -- --live           # one real Gemini advisory request (uses quota)
 *   npm run verify:claude                     # free: confirms the model id exists for your key
 *   npm run verify:claude -- --live           # PAID: one real advisory request (~a few thousand tokens)
 *   npm run verify:vision -- --image trap.jpg # one real inference call on a local JPEG/PNG
 *   npm run verify:supabase                   # read-only: tables, RPC grant, bucket privacy
 *   npm run verify:supabase -- --write        # writes ONE test capture twice (checks idempotency)
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { DEMO_DEVICE_ID, loadConfig } from '../src/config.js';
import { createLogger } from '../src/utils/logger.js';
import { createAdvisor, classifyClaudeError, classifyGeminiError } from '../src/services/advisor.js';
import { createVision } from '../src/services/vision.js';
import { decodeImage } from '../src/utils/validate.js';

const [target, ...flags] = process.argv.slice(2);
const flag = (name) => flags.includes(name);
const flagValue = (name) => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
};

const { config, errors } = loadConfig();
if (errors.length) {
  console.error('Configuration errors:\n - ' + errors.join('\n - '));
  process.exit(1);
}
const logger = createLogger();
const pass = (msg) => console.log(`PASS  ${msg}`);
const fail = (msg) => {
  console.log(`FAIL  ${msg}`);
  process.exitCode = 1;
};

async function verifyClaude() {
  if (!config.claude.apiKey) return fail('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: config.claude.timeoutMs, maxRetries: 1 });
  try {
    const model = await client.models.retrieve(config.claude.model);
    pass(`model available: ${model.id} (${model.display_name})`);
  } catch (err) {
    return fail(`model lookup failed: ${classifyClaudeError(err).code}`);
  }
  if (!flag('--live')) return console.log('INFO  add --live to send one real (billed) advisory request');

  const advisor = createAdvisor({ config: { ...config, advisor: { provider: 'claude' } }, client, logger });
  const adv = await advisor.generate(SAMPLE_CONTEXT());
  console.log(JSON.stringify(adv, null, 2));
  adv.source === 'claude' ? pass(`real Claude advisory (${adv.latency_ms} ms)`) : fail(`fell back: ${adv.error?.code}`);
}

/** Same sample context for every live advisory check. */
const SAMPLE_CONTEXT = () => ({
  capture_time: new Date().toISOString(),
  device_name: 'verify-script',
  pest_counts: { aphid: 18, whitefly: 6, thrips: 1, fungus_gnat: 0 },
  temperature: 27.4,
  humidity: 81,
  history: [
    { time: new Date(Date.now() - 7200e3).toISOString(), total: 9, temperature: 25.1, humidity: 72 },
    { time: new Date(Date.now() - 3600e3).toISOString(), total: 14, temperature: 26.3, humidity: 76 },
  ],
  detection: { simulated: false, counted: 25, threshold: 0.5, mean_confidence: 0.82, min_confidence: 0.55 },
});

async function verifyGemini() {
  if (!config.gemini.apiKey) return fail('GEMINI_API_KEY is not set');
  if (config.advisor.provider !== 'gemini') {
    console.log(`INFO  ADVISOR_PROVIDER resolves to "${config.advisor.provider}" - the server will not use Gemini`);
  }
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({
    apiKey: config.gemini.apiKey,
    httpOptions: { timeout: config.gemini.timeoutMs, retryOptions: { attempts: 1 } },
  });
  try {
    const model = await client.models.get({ model: config.gemini.model });
    pass(`model available: ${model.name} (${model.displayName ?? 'no display name'})`);
  } catch (err) {
    return fail(`model lookup failed: ${classifyGeminiError(err).code} (HTTP ${err.status ?? 'n/a'})`);
  }
  if (!flag('--live')) return console.log('INFO  add --live to send one real advisory request (uses quota / may be billed)');

  const advisor = createAdvisor({ config: { ...config, advisor: { provider: 'gemini' } }, client, logger });
  const adv = await advisor.generate(SAMPLE_CONTEXT());
  console.log(JSON.stringify(adv, null, 2));
  adv.source === 'gemini' ? pass(`real Gemini advisory (${adv.latency_ms} ms)`) : fail(`fell back: ${adv.error?.code}`);
}

async function verifyVision() {
  if (!config.vision.url) return fail('YOLO_API_URL is not set');
  const path = flagValue('--image');
  const url = flagValue('--url');
  if (!path && !url) return fail('pass --image <file.jpg> or --url <public image url>');
  const vision = createVision({ config, logger });
  const image = path ? decodeImage(readFileSync(path).toString('base64'), config.maxImageBytes) : null;
  const res = await vision.detect({ imageUrl: url ?? null, image });
  console.log(JSON.stringify({ ...res, boxes: res.boxes.slice(0, 10), total_boxes: res.boxes.length }, null, 2));
  res.status === 'ok'
    ? pass(`${res.boxes.length} boxes, ${res.rejected} rejected, image ${JSON.stringify(res.image)}, ${res.latency_ms} ms`)
    : fail(`vision ${res.status}: ${res.error?.code}`);
  console.log('INFO  compare counts against a manual count of the same image before trusting the model');
}

async function verifySupabase() {
  if (!config.supabase.url) return fail('SUPABASE_URL is not set');
  const { createClient } = await import('@supabase/supabase-js');
  const { createSupabaseStore } = await import('../src/db/supabaseStore.js');
  const client = createClient(config.supabase.url, config.supabase.serviceRoleKey, { auth: { persistSession: false } });
  const store = createSupabaseStore({ config, client, logger });

  try {
    await store.ping();
    pass('devices table reachable');
  } catch (err) {
    return fail(`database unreachable: ${err.cause?.message ?? err.message}`);
  }
  for (const col of ['capture_id', 'image_path']) {
    const { error } = await client.from('sensor_telemetry').select(col).limit(1);
    error ? fail(`sensor_telemetry.${col} missing - apply supabase/schema.sql`) : pass(`sensor_telemetry.${col} exists`);
  }
  const { data: bucket, error: bErr } = await client.storage.getBucket(config.supabase.bucket);
  if (bErr) fail(`bucket "${config.supabase.bucket}" not found`);
  else bucket.public ? fail('bucket is PUBLIC - re-run schema.sql to make it private') : pass('bucket exists and is private');

  // Anonymous access must be blocked by RLS (needs SUPABASE_ANON_KEY just for this check)
  if (process.env.SUPABASE_ANON_KEY) {
    const anon = createClient(config.supabase.url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anon.from('devices').update({ battery_level: 1 }).eq('id', DEMO_DEVICE_ID).select();
    const { data } = await anon.from('devices').select('id');
    !error && data?.length ? fail('anon key can read devices - RLS not enabled') : pass('anon key cannot read/modify devices (RLS)');
  } else {
    console.log('INFO  set SUPABASE_ANON_KEY in the shell (not .env) to also test that RLS blocks anonymous access');
  }

  if (!flag('--write')) return console.log('INFO  add --write to insert one test capture and check idempotency');
  const capture_id = randomUUID();
  await store.ensureDevice(DEMO_DEVICE_ID, 'Greenhouse A - Trap 01');
  const payload = {
    telemetry: { device_id: DEMO_DEVICE_ID, capture_id, timestamp: new Date().toISOString(), temperature: 21.5, humidity: 60, image_url: null, image_path: null },
    detection: { pest_counts: {}, bounding_boxes: [], ai_advisory: { source: 'none', status: 'skipped', summary: 'verify-script test row' }, vision_meta: { status: 'skipped' } },
  };
  const first = await store.ingestCapture(payload);
  const second = await store.ingestCapture(payload);
  first.duplicate === false && second.duplicate === true && first.telemetry.id === second.telemetry.id
    ? pass(`atomic idempotent ingest works (telemetry id ${first.telemetry.id}, capture_id ${capture_id})`)
    : fail('idempotency check failed');
}

const targets = { gemini: verifyGemini, claude: verifyClaude, vision: verifyVision, supabase: verifySupabase };
if (!targets[target]) {
  console.error('Usage: node scripts/verify-integrations.js <gemini|claude|vision|supabase> [flags]');
  process.exit(2);
}
await targets[target]();
