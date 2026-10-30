# Agrisense AI: audit, verification and readiness report

> **Update 2026-10-30:**
> - **Gemini is now the advisory LLM.** It uses the official `@google/genai` SDK, and Claude remains an
>   optional alternative selected with `ADVISOR_PROVIDER`.
> - **Device keys can be bound to one device.** A key can be written as `<uuid>:<key>`.
> - **CSP added** on the API and on the built dashboard.
> - **Results:** backend 42/42 tests, frontend 13/13, build passing. Gemini is mocked only; no key has been
>   provided yet.

Date: 2026-10-29. Environment: Windows 11, Node 24.22, **no Python interpreter** (only the Microsoft Store
stub), no API credentials, no Raspberry Pi hardware.

## 1. Audit (before this pass)

| # | Severity | Finding | Resolution |
|---|---|---|---|
| A1 | Critical | No authentication on ingestion or admin endpoints, so anyone could post data or change battery levels | Device and admin API keys (constant-time comparison). Required whenever `DEMO_MODE=false` or `NODE_ENV=production`, and the server refuses to start without them |
| A2 | Critical | A failed vision call fell back to **simulated detections**, and real photos without a model got random boxes, so fabricated detections were presented as real | Explicit `ok/simulated/failed/not_configured/skipped` states. Only synthetic demo traps are simulated |
| A3 | High | Sensor values were silently **clamped** (humidity 150 stored as 100) | Out-of-range values return 422. `null` means "not measured", and 0 is valid |
| A4 | High | No idempotency: a retried upload created duplicate captures | `capture_id` (unique) plus the atomic `ingest_capture()` RPC. Retries return 200 with `duplicate:true` |
| A5 | High | Telemetry and detection were written as two separate inserts, so a failure between them left a half-written capture | One transactional RPC. The memory store is atomic too |
| A6 | High | Supabase bucket was **public**, tables had **no RLS** | Private bucket with signed URLs. RLS on all tables. The RPC can only be run by `service_role` |
| A7 | High | Server-side refusal `fallbacks` switched Claude models automatically, and Claude output was saved without validation | Model fallback removed. Strict re-validation, dose scrubbing, error classification, labelled rule-engine fallback |
| A8 | Medium | Image uploads not validated (type, magic bytes, size before decoding) | JPEG/PNG/WebP magic-byte check, size limit, deterministic object path |
| A9 | Medium | No startup config validation, and secrets could be half-configured | `loadConfig` sorts problems into errors and warnings and never prints secret values |
| A10 | Medium | No rate limiting, no readiness endpoint, no request ids, unstructured logs | Per-IP limiter, `/api/ready`, `X-Request-Id`, JSON logs with redaction |
| A11 | Medium | Manual battery value looked like a sensor reading | `battery_source` (`manual`/`device`) and `battery_updated_at`, shown in the UI |
| A12 | Medium | Dashboard: overlapping polls and stale responses could show one device's data under another; auto-stream could overlap requests; `null` readings would crash `toFixed` | Request sequencing, in-flight guards, device-switch reset, null-safe formatting |
| A13 | Medium | Simulator had no offline persistence, no hardware mode and no Pi service | SQLite queue, uploader, hardware drivers, systemd unit |
| A14 | Low | No automated tests or lint | 34 backend and 12 frontend tests, plus a Python test suite (not run, see below). No linter configured (not added, to avoid new tooling) |
| A15 | Low | `.gitignore` didn't cover `.env.*`, queue DBs or logs | Updated |

## 2. Verification results

| Check | Status | Command / evidence |
|---|---|---|
| Backend tests (34, all external APIs mocked) | **PASS** | `cd backend && npm test` → `tests 34, pass 34, fail 0` |
| Backend syntax check | **PASS** | `npm run check` → `21/21 files passed` |
| Frontend tests (12) | **PASS** | `cd frontend && npm test` → `Tests 12 passed (12)` |
| Frontend production build | **PASS** | `npx vite build` → `built` (bundle ~670 kB, a size warning only) |
| Dependency audit | **PASS** | `npm audit` → 0 vulnerabilities (backend prod, frontend) |
| Live demo server end to end (curl) | **PASS** | 6 mock captures → 201; same `capture_id` twice → `dup=false` then `dup=true`, same id; real PNG without a model → `vision=not_configured`, `adv=none/skipped`; battery 14 → `low_battery`, `battery_source: manual` |
| Live auth enforcement (second instance, generated keys) | **PASS** | no key 401, bad key 403, device key 201, device key on admin 403, admin key 200; 0 key occurrences in the log |
| Startup refuses an insecure config | **PASS** | `DEMO_MODE=false` without keys → `config_invalid` × 2, exit |
| Dashboard in browser (desktop and 375 px mobile) | **PASS** | Provenance badges, "Not counted", `—` for a missing reading, manual-battery banner, 53 simulated boxes aligned on the trap, no horizontal scroll |
| Python edge tests (`tests/test_edge.py`) | **BLOCKED** | No Python interpreter on this machine. The code was written but **never executed** |
| Python simulator run | **BLOCKED** | Same reason |
| Gemini advisor (mocked: valid output, invalid JSON/schema, empty text, SAFETY stop, prompt block, MAX_TOKENS, 429, invalid key, 404 model, 503, network, timeout) | **PASS** | `npm test` → `tests/gemini.test.js` |
| Gemini SDK call shape | **PASS (static)** | Checked against the installed `@google/genai` 2.32.0 type definitions (`models.generateContent`, `responseJsonSchema`, `httpOptions.timeout` in ms, `retryOptions.attempts`, `models.get`, `ApiError.status`) |
| Gemini key + model lookup | **PASS** (2026-10-30) | `npm run verify:gemini` → `PASS model available: models/gemini-3.6-flash` |
| Gemini live advisory | **PASS** | `npm run verify:gemini -- --live` → schema-valid, cautious advisory, `source: gemini`, ~13 s |
| Full pipeline with Gemini (running backend) | **PASS** | Capture → `gemini/ok gemini-3.6-flash`, ~16 s. The model flagged "confidence is Low … simulated demo data" |
| `gemini-3.8-flash` (default) | **FAIL (provider-side)** | Google returned 503 "high demand" and 504 DEADLINE_EXCEEDED even for a 1-word prompt. `gemini-3.6-flash` (2.3 s) and `gemini-3.5-flash-lite` (1.3 s) worked, so the local `.env` uses `gemini-3.6-flash` |
| Transient Gemini outage handling (real) | **PASS** | One live capture got `api_unavailable`. It was saved with a labelled rule-engine fallback |
| Invalid Gemini key (real API) | **PASS** | → `rule-engine/fallback`, `error.code: auth_error`, capture saved, key not in logs |
| Device-bound keys | **PASS** | Own device 201, another device 403 `device_mismatch`, `device_id` defaults to the bound device |
| Claude live call | **BLOCKED** | No `ANTHROPIC_API_KEY` (Claude is now optional). Mocked only |
| Roboflow API key (2026-10-30) | **PASS** | Key is valid for workspace `samhiths-workspace-pnyf0` (checked with header auth, not a query string) |
| Vision provider live call | **BLOCKED** | The only project, `agrisense-ai-pest-trap-detection`, has 0 images, 0 classes and 0 versions (no trained model). `YOLO_API_URL` has no `/<project>/<version>` path. Mocked only |
| Supabase schema applied (2026-10-30) | **PASS** | `verify:supabase`: all tables, v2 columns, demo device seeded; bucket private, 10 MB, JPEG/PNG/WebP only |
| Supabase atomic idempotent ingest | **PASS** | `verify:supabase -- --write`: the same capture twice → one row, `duplicate: true` |
| Full pipeline on Supabase | **PASS** | Synthetic capture → `gemini/ok`. Real PNG upload → `captures/<device>/<capture_id>.png`; a retry returns the same id with `dup=true` |
| Private images | **PASS** | The signed URL serves bytes identical to the upload; the same object without a token → HTTP 400 |
| Persistence across restart | **PASS** | 3 captures, the Gemini advisory and the photo are all present after a backend restart |
| Supabase RLS blocks the anon key | **NOT RUN** | Needs the project's anon key in the shell: `SUPABASE_ANON_KEY=… npm run verify:supabase` |
| Bug found: false "ready" on an empty project | **FIXED** | `ping()` used a HEAD request that hid "table not found". It now uses GET and also checks the v2 schema. Unit test added |
| Bug found: dev server dropped requests | **FIXED** | `node --watch` restarted on lazily-loaded `node_modules` files (Windows), cutting off requests. `npm run dev` now watches `src/` only |
| Bug found: private trap photo flickered or stayed invisible | **FIXED** | Each poll returns a new signed URL, which remounted the image. It's now keyed by storage path and reuses the URL for 45 min. Verified in the browser over 3 polls; test added |
| Raspberry Pi camera/sensor/systemd | **BLOCKED** | No hardware |
| Lint | **NOT RUN** | No linter configured in the project |

## 3. Integration status

| Integration | Implemented | Verified |
|---|---|---|
| **Gemini** (`@google/genai`), the default advisor | Yes: JSON-schema output, re-validation, timeout and retries, block/safety handling, error codes, labelled fallback | **Verified live** with `gemini-3.6-flash`: success, a transient outage and an invalid key. `gemini-3.8-flash` was overloaded at test time |
| Claude (`claude-opus-5-5`, official SDK), optional | Yes: same features | Mocks only |
| Vision (Roboflow serverless / generic) | Yes: URL and base64 input, normalization, validation, failure states | Mocks only. Roboflow URL, auth and response shape checked against its docs; the base64 body format is not on the current docs page |
| Supabase | Yes: schema v2, atomic RPC, RLS, private bucket, signed URLs | **Verified live**: schema, idempotent ingest, private upload with signed URLs, persistence. The anon-key RLS check has not been run yet |
| Python simulator mode | Yes: queue, idempotent upload, backoff | **Not executed** |
| Pi hardware mode | Yes: Picamera2, BME280, DHT22, `--probe`, systemd | **Not executed** |

## 4. Remaining security risks

1. **Read endpoints are public.** Anyone who can reach the API can read trap history and device names.
   Mitigate with network or platform access control, or add read auth.
2. **Bearer keys**: device keys *can* now be bound to one device (`<uuid>:<key>`), but plain keys still work
   for any device. There's no key rotation tooling and no expiry. Use HTTPS only.
3. **Admin key in `sessionStorage`**: an XSS bug could steal it. This is mitigated by the strict CSP on the
   built dashboard (`_headers` / `vite preview`), but the dev server has no CSP and other static hosts must
   be configured by hand.
4. **Demo mode is unauthenticated by design.** Never expose a `DEMO_MODE=true` instance publicly.
5. The in-memory rate limiter doesn't protect a multi-instance deployment.
6. `image_url` captures are passed to the vision provider, which then fetches whatever URL a device supplies.
   That's acceptable for trusted devices, but restrict it if devices are untrusted.

## 5. Readiness

| Target | Assessment |
|---|---|
| Hackathon demo | **Ready.** Verified locally in demo mode, with honest labels for simulated data |
| Real API integration | **Code-complete, unverified.** Needs the Gemini, Roboflow and Supabase keys plus the checklist in the README (about 30 min) |
| Raspberry Pi field test | **Not yet.** Python code has never run. Run the unit tests and `--probe` on a Pi first |
| Production | **Not ready.** Needs live integration verification, read-access control, CSP, monitoring, a labelled accuracy evaluation, and a persistent rate limiter or gateway |
