# 🌱 Agrisense AI: Predictive Insect Monitoring System

Raspberry Pi sticky traps → vision model insect detection → LLM agronomic advisory (Gemini, or Claude) → farmer dashboard.

```
 Raspberry Pi 5 (edge-simulator/)                 Backend API (backend/)                        Supabase
┌──────────────────────────────┐  HTTPS + key  ┌───────────────────────────────────┐   ┌──────────────────────┐
│ camera + BME280/DHT22        │ ────────────▶ │ auth → validate → idempotency     │──▶│ devices              │
│ SQLite offline queue         │  capture_id   │ → private image upload            │   │ sensor_telemetry     │
│ retry/backoff, systemd       │ ◀──── 201 ─── │ → vision API (Roboflow / generic) │   │ pest_detections      │
└──────────────────────────────┘               │ → Gemini/Claude advisory (or rules)│  │ ingest_capture() RPC │
                                               │ → ONE atomic DB write             │   │ private bucket + RLS │
 Dashboard (frontend/)  ── GET, polling 5s ──▶ │ /api/health  /api/ready           │   └──────────────────────┘
 React + Vite + Tailwind ── admin key ───────▶ │ PATCH /api/device/battery (admin) │
                                               └───────────────────────────────────┘
```

Every result says where it came from. Detections are `ok` (model), `simulated` (synthetic demo trap),
`failed`, `not_configured` or `skipped`. Advisories are `gemini/ok` (or `claude/ok`), `rule-engine/not_configured`,
`rule-engine/fallback` (the LLM failed, with the provider and reason) or `none/skipped`. Readings are labelled
`hardware`, `simulator` or `dashboard`, and battery values `manual` or `device`. The dashboard shows
all of these labels.

**Demo mode** (the default in development): with no keys, the API runs with an in-memory store, simulated
detections for the synthetic trap images only, the rule-based advisor and no authentication. Real photos
are never given made-up detections.

> Status: the demo is verified locally. Gemini, the vision provider, Supabase and the Raspberry Pi hardware are
> implemented and tested only against mocks. See [docs/REPORT.md](docs/REPORT.md) and the
> [live checklist](#real-integration-checklist).

---

## Repository layout

```
backend/                Node.js 20+ / Express 5 API
  src/app.js            app factory (DI for tests), security headers, health/ready
  src/server.js         config validation → wiring → listen, graceful shutdown
  src/config.js         env parsing + validation (errors vs. warnings, no secrets printed)
  src/routes/           telemetry.js (ingestion pipeline), devices.js (devices + battery)
  src/services/         vision.js, advisor.js, mockTrap.js
  src/db/               supabaseStore.js, memoryStore.js (same interface)
  src/middleware/       auth.js, rateLimit.js, errors.js
  scripts/              verify-integrations.js (live checks), check-syntax.js
  tests/                node:test suites (all providers mocked)
frontend/               React 19 + Vite + Tailwind v4 + Recharts dashboard
  src/components/       FarmerDashboard, TrapCanvas, AdvisoryCard, MicroclimateChart, AdminPanel, Badge
  src/test/             Vitest + Testing Library
edge-simulator/         Python 3.9+ edge collector
  simulator.py          CLI: --mode simulator | hardware
  agrisense_edge/       queue_store.py (SQLite), uploader.py, hardware.py, simulated.py
  deploy/               agrisense-edge.service (systemd)
  tests/test_edge.py    unittest (no hardware/network needed)
frontend/src/map/       Pest Surveillance Map: PestMapPage (no kepler imports), KeplerView (lazy),
                        store.js (Redux for this page only), keplerConfig.js, shims/assert.js
demo/seed.py            simulated 14-day whitefly outbreak for the map (18 SIM traps)
supabase/schema.sql     idempotent schema v3 (also upgrades v1/v2 installs)
docs/REPORT.md          audit, verification results, security notes, readiness
DECISIONS.md            architecture/engineering decisions (kepler.gl choices, npm audit, etc.)
```

## Prerequisites

| Component | Version |
|---|---|
| Node.js | 20 or later (tested on 24.x) |
| Python (edge) | 3.9 or later (Raspberry Pi OS Bookworm ships 3.11) |
| Supabase | any current project (optional) |
| Raspberry Pi | Pi 5 + Camera Module (libcamera/Picamera2) + BME280 (I²C) or DHT22 (GPIO) |

---

## Local setup (Windows PowerShell / macOS / Linux)

```bash
cd backend
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run dev                   # http://localhost:4000
```

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

```bash
cd edge-simulator
python -m venv .venv
.venv/Scripts/activate        # Windows; macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python simulator.py --once
```

The simulator CLI:

| Command | What it does |
|---|---|
| `python simulator.py` | Mock capture every `AGRISENSE_INTERVAL` seconds, forever |
| `python simulator.py --interval 3 --count 20` | 20 mock captures, 3 s apart |
| `python simulator.py --surge` | Hot, humid outbreak scenario |
| `python simulator.py --image trap.jpg` | Mock readings with a real photo |
| `python simulator.py --report-battery` | Adds a simulated draining battery |
| `python simulator.py --status` | Shows queue counts (pending / sent / dead) |
| `python simulator.py --flush-only` | Uploads queued captures, then exits |

Every capture is queued in `edge-data/queue.db` first. Stop the backend, run the simulator, and the captures
stay queued. Start the backend again and they upload with no duplicates.

No Python? **Admin & Hardware Control → Edge Capture Simulator** in the dashboard sends the same kind of
captures (labelled `dashboard`), with an auto-stream mode.

---

## English / ಕನ್ನಡ

An **EN | ಕನ್ನಡ** switch in the header translates the farmer-facing pages: **Farmer Analytics** (headline, KPIs,
simulated banner, decision panel, *Can I spray now?*, *What did you do?*, card titles), the **trap cards**
and **Phone Check**. The map and admin pages stay English, and the switch is hidden there. The choice is
remembered per browser.

- Decision reasons come from the engine in English. In Kannada they are **rebuilt from the same numbers**
  (pests/day, per predator, the action level, BORDERLINE), not machine-translated.
- Gemini advice steps stay in English, marked *(ವಿವರಗಳು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ)*.
- Text lives in `frontend/src/lib/i18n.jsx`. A test fails if any English key lacks a Kannada one.
- Kannada renders with system fonts (Noto Sans Kannada on Android, Nirmala UI or Tunga on Windows).
- **The Kannada wording is a first draft: have a native speaker or the IIHR team review it.**

## Telegram summaries and alerts (English + ಕನ್ನಡ)

- **Daily summary** at `TELEGRAM_SUMMARY_TIME` (default 07:00 IST): every trap's traffic-light decision
  (🔴▲ SPRAY, 🟠◆ RELEASE BIOCONTROL, 🟢● WAIT, ⚪■ CHECK TRAP), with pests per day, pests per predator, and
  BORDERLINE / simulated tags, most urgent first, plus the spray window. It is sent in English and Kannada
  (`TELEGRAM_LANGUAGE=en|kn|both`).
- **Instant alert** when a capture changes a trap's advice to SPRAY, RELEASE BIOCONTROL or CHECK TRAP. It is
  sent once per trap and decision per 6 h, never for WAIT, and never delays ingestion.
- **Setup:**
  1. Create a bot with **@BotFather** and put the token in `TELEGRAM_BOT_TOKEN`.
  2. Send the bot a message (or add it to a group) and restart the backend.
  3. Go to *Admin & Hardware Control → Telegram alerts → Find my chat id*, put that number in
     `TELEGRAM_CHAT_ID`, restart, and press **Send test**.
- The same card has *Preview summary* (works before setup), *Send test* and *Send summary now*.
- The bot token is used by the backend only. Telegram puts it in the request URL, so errors are reduced to a
  status code before logging; it never appears in logs, API responses or the browser.
- The **Kannada wording is a first draft**: have a native speaker or the IIHR team review it
  (`backend/src/services/telegram.js` → `TEXT.kn`).

## Action log

The **What did you do?** card (Farmer Analytics, under the spray-window card) lets the farmer log
**Sprayed**, **Released predators** or **Not yet**, with an optional note, against the trap's current advice.
The advice at that moment is computed and stored by the server ('advice was ▲ SPRAY'), never taken from the
browser. The last 5 entries are listed (the newest can be undone), and every entry appears as a labelled,
coloured **marker on the trap chart** at the capture it followed, so the effect of a spray or release is
visible. Logging needs the admin key, like other dashboard writes. *Reset demo data* seeds two story
entries: Polyhouse 1 *Not yet* (waiting for dry weather) and Polyhouse 2 *Released*.

**Needs schema v4:** run `supabase/migrations/v4_action_log.sql` once in the Supabase SQL editor (it is also
folded into `supabase/schema.sql`). Until then the card says exactly that, and everything else keeps working.

## Impact estimate

The **Estimated impact** card (Farmer Analytics, under the trap cards; `GET /api/impact?days=30`) compares
the traps' decisions with **routine calendar spraying** (every 7 days whatever the pest level), over
**all** traps for the last 14 or 30 days:

- **Calendar:** one spray per 7 days per trap.
- **AgriSense:** one spray when a trap turns SPRAY, and another if it is still SPRAY 7 days later. WAIT and
  RELEASE BIOCONTROL days are not sprayed; biocontrol releases are counted separately.
- **Sprays avoided** = calendar - AgriSense (never negative per trap), plus the percentage fewer, **litres of
  pesticide product** and **rupees** (product + labour) at 0.5 acre per trap, 0.25 L and ₹1,500 per acre per
  spray, and the **trap-days on which predators were spared** (RELEASE BIOCONTROL).
- It is **always labelled ESTIMATE**, with *Simulated data* when the inputs are simulated. The assumptions
  sit under *How this is estimated*, and live in `backend/config/pests.json` → `impact` as placeholders to
  confirm with the IIHR mentor and local farmers. **It is not a measured result.**

## What-if simulator

The **What if…?** card on Farmer Analytics starts from the selected trap's real 3-day averages and lets you
move **pests/day**, **predators/day** and **detector confidence**, or try quick scenarios (*release
predators*, *pests double*, *after a spray*, *low detector confidence*). Every answer comes from the
backend's decision engine (`GET /api/decision/simulate`), the same function that decides for real traps.
Nothing is re-implemented in the browser. The decision map shades the WAIT, RELEASE BIOCONTROL and
SPRAY regions computed by that engine, with the 25/day action line and the 10:1 ratio line. A white dot
marks the what-if and a ring marks the trap now. It shows judges at a glance why releasing predators
changes the advice.

## Weather: spray window and degree-days

The dashboard's **Can I spray now?** card uses the free [Open-Meteo](https://open-meteo.com) forecast
(no API key; called from the backend; `GET /api/weather?device_id=` or `?lat=&lon=`) at the trap's
coordinates, or the IIHR default location (labelled as such).

- **Spray now?** Checked hour by hour. You can spray only when **no rain is expected in the next 6 h**
  (chance below 40%, under 0.2 mm), **wind is at most 15 km/h** (gusts at most 25) so it won't drift, and
  it is **daylight**. Heat above 32 °C and very still air are shown as cautions. If you can't spray now,
  the card shows the **next good window** (at least 2 good hours in a row, searching 72 h ahead). When the
  trap's decision is SPRAY, it says *"Spraying is advised, but wait for the window: Tomorrow 06:00-09:00"*.
- **Degree-days:** daily degree-days = max(0, min(mean temperature, 32) - 10 °C) from the forecast daily
  max/min. One whitefly generation takes about 300 degree-days, so at the forecast rate the card says how
  many days a generation takes and when eggs laid today would become adults.
- The rules are in `backend/config/pests.json` (`spray_window`, `degree_days`) and are **placeholders**,
  to confirm with the IIHR mentor and the product label.
- **Never blocks:** a 4 s timeout and a 30-minute cache per location (about 1 km cell). The last good
  forecast is served, labelled *stale*, for up to 6 h if Open-Meteo is down; otherwise the card shows a quiet
  note. Pest decisions never depend on weather.

## Phone check

*Phone Check* (sidebar / **Check** tab) lets a farmer photograph a yellow sticky card and enter how many days
it hung. On a phone, **Take or choose a photo** opens the camera. The photo is corrected for orientation and
resized to at most 2600 px in the browser, so uploads stay small on rural connections.

The backend (`POST /api/check`) runs the same pipeline as a trap capture: the quality check, then Roboflow
with tiling, then the predator-aware decision, then the Gemini advisory that explains it. Counts are divided
by the days hung to give **pests per day**, so the same card means a lower daily rate the longer it hung.
The answer shows the traffic-light decision with its reason, count range and BORDERLINE tag, the whitefly
and predator (MR/NC) counts, the annotated photo, the photo-quality verdict and the advice. A card that hung
only 1-2 days is flagged as a short window. A rejected photo gives **CHECK TRAP** with retake advice.
**Nothing is stored.** The endpoint is public but rate-limited (`RATE_LIMIT_CHECK_MAX`, default 20 per
window per IP), because each check can cost vision and LLM calls.

## Demo mode

One click loads four **DEMO** traps with 14 days of simulated captures (two per day: 08:00 and 17:00 IST),
built so that every decision appears:

| Trap | Story | Ends as |
|---|---|---|
| DEMO · Polyhouse 1 (tomato) | whitefly climbing, almost no predators | ▲ SPRAY |
| DEMO · Polyhouse 2 (tomato) | whitefly high, but Macrolophus/Nesidiocoris build up | ◆ RELEASE BIOCONTROL |
| DEMO · Net-house (capsicum) | hovering just under 25/day | ● WAIT, BORDERLINE |
| DEMO · Polyhouse 3 (cucumber) | last photo unreadable (fogged lens) | ■ CHECK TRAP |

- **Dashboard:** *Admin & Hardware Control → Demo mode → Reset demo data* (needs the admin key).
- **Terminal:** `cd backend && npm run demo:reset` (reads `ADMIN_API_KEY` from `backend/.env`; add `-- --clear` to remove them).
- Reset any time: it deletes the DEMO traps and re-seeds them, ending at the current time. Run it again before a
  presentation, because a trap with no capture for 48 hours turns grey (CHECK TRAP).
- Nothing is passed off as real. Every DEMO capture is `data_source: simulator`, its detections come from the
  **demo detector** (synthetic sticky-card images whose boxes are generated), and its advisory is the rule engine
  labelled *demo*. The dashboard shows a **Simulated data / Demo detector** banner on these captures. A reset makes
  no vision or LLM calls, so it costs nothing and works offline.

## Pest Surveillance Map

The **Pest Surveillance Map** page (sidebar → *Pest Surveillance Map*) shows every trap on a kepler.gl map:
- **Colour** shows the predator-aware decision: red **SPRAY**, amber **BIOCONTROL** (release biocontrol), green **WAIT**.
  The decision averages the last 3 days: at least 25 pests/day with 10+ pests per predator means SPRAY; at least 25/day with
  fewer pests per predator means RELEASE BIOCONTROL; otherwise WAIT. The thresholds in `backend/config/pests.json` are
  **placeholders to confirm with the IIHR mentor** (see DECISIONS.md D7).
- **Size** shows the pest count.
- **Time filter:** a one-day filter on `date`; press ▷ on the timeline to replay an outbreak day by day.
- **Trap list:** a table under the map lists every trap for any day, with or without the map.

To load the simulated demo outbreak (18 `SIM ·` traps around Bengaluru Rural and Kolar, 14 days), with the backend running:

```bash
python demo/seed.py --dry-run
```
```bash
python demo/seed.py --admin-key <ADMIN_API_KEY>
```
```bash
python demo/seed.py --reset --admin-key <ADMIN_API_KEY>
```
```bash
python demo/seed.py --remove --admin-key <ADMIN_API_KEY>
```

The first prints the traps and a few rows without sending anything. The second loads the data
(re-running it is safe). `--reset` replaces previous simulated traps, and `--remove` deletes them.
The admin key can also come from `AGRISENSE_ADMIN_KEY`, and you can leave it out when the backend
runs in demo mode without keys.

How the map behaves:
- **Simulated data** is labelled everywhere: trap names start with `SIM ·`, every row carries
  `simulated: true`, and the page shows a **Simulated data** badge. Simulated traps are kept out
  of the main dashboard's trap picker.
- **Real traps** appear once they have coordinates:
  `PATCH /api/device/location {device_id, latitude, longitude}` (admin).
  Their captures are rolled up per day automatically.
- **Supabase:** re-run `supabase/schema.sql` (v3 adds the coordinates and the
  `trap_daily_observations` table). Until then the map shows real data plus a warning, and
  seeding returns 503.
- **Basemap:** the default CARTO / MapLibre basemap needs **no token**. Set `VITE_MAPBOX_TOKEN`
  in `frontend/.env` (a public, URL-restricted `pk.` token) to add a satellite style.
- **No map available:** with no internet for tiles, or no WebGL, the page explains why and still
  lists all trap data. kepler.gl isn't even downloaded in that case.
- **Bundle size:** the map code (about 2 MB gzipped) is a separate lazy chunk, so the rest of the
  dashboard loads as before.

Why kepler.gl is pinned to a pre-release, the deck.gl version overrides, the CSP additions and
the `npm audit` findings are all in [DECISIONS.md](DECISIONS.md).

## Environment variables

### Backend (`backend/.env`)

`R` = required outside demo mode, `O` = optional, `D` = only matters for the demo.

| Variable | | Default | Purpose |
|---|---|---|---|
| `PORT` | O | 4000 | API port |
| `NODE_ENV` | O | development | `production` turns demo mode off by default and forbids `CORS_ORIGINS=*` |
| `DEMO_MODE` | D | true (dev) | Allows unauthenticated access when keys are unset |
| `PUBLIC_BASE_URL` | O | http://localhost:PORT | Used for synthetic trap URLs |
| `CORS_ORIGINS` | O | http://localhost:5173 | Comma-separated dashboard origins |
| `TRUST_PROXY` | O | false | Set to `true` behind a reverse proxy so rate limits see real client IPs |
| `REQUEST_TIMEOUT_MS` | O | 120000 | Server request timeout |
| `MAX_IMAGE_BYTES` | O | 10485760 | Upload limit (JPEG/PNG/WebP, checked by magic bytes) |
| `DEVICE_API_KEYS` | R | – | Comma-separated, at least 16 characters each. `<key>` works for any device; `<device-uuid>:<key>` only for that device (recommended) |
| `ADMIN_API_KEY` | R | – | Admin key (battery override, device registration), at least 16 characters |
| `RATE_LIMIT_WINDOW_MS` / `_INGEST_MAX` / `_ADMIN_MAX` | O | 60000 / 120 / 60 | Requests per IP per window |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | O | – | Both or neither. Server-side only |
| `SUPABASE_BUCKET` | O | trap-images | Private storage bucket |
| `SUPABASE_SIGNED_URL_TTL` | O | 3600 | Lifetime of image links, in seconds |
| `VISION_PROVIDER` | O | roboflow | `roboflow` or `generic` |
| `YOLO_API_URL` / `YOLO_API_KEY` | O | – | Vision endpoint and key |
| `VISION_MODEL_ID` | O | – | Model identifier stored with each detection |
| `VISION_MIN_CONFIDENCE` | O | 0.5 | Boxes below this are shown but not counted |
| `YOLO_TIMEOUT_MS` | O | 15000 | Vision request timeout |
| `ADVISOR_PROVIDER` | O | auto | `auto` (Gemini if its key is set, then Claude, then rules), `gemini`, `claude` or `none` |
| `GEMINI_API_KEY` | O | – | Turns on Gemini advisories ([AI Studio](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL` | O | gemini-3.8-flash | Check with `npm run verify:gemini` |
| `GEMINI_TIMEOUT_MS` / `GEMINI_MAX_RETRIES` | O | 30000 / 2 | SDK timeout and bounded retries |
| `ANTHROPIC_API_KEY` | O | – | Optional alternative: Claude advisories |
| `CLAUDE_MODEL` / `CLAUDE_EFFORT` | O | claude-opus-5-5 / medium | Used only when the provider is Claude |
| `CLAUDE_TIMEOUT_MS` / `CLAUDE_MAX_RETRIES` | O | 60000 / 2 | SDK timeout and bounded retries |

Supabase anon or publishable keys are **not used**: the browser never talks to Supabase directly.
The server refuses to start on invalid configuration (for example half-set Supabase variables, a bad URL,
a short key, an unknown effort level, or missing keys with `DEMO_MODE=false`) and lists each problem
without printing secret values.

### Frontend (`frontend/.env`)

`VITE_API_URL` (backend origin, for production builds only) and `VITE_POLL_MS`. Everything in a `VITE_*`
variable ends up in the public bundle, so never put a key there. The admin key is typed into the
Admin tab at runtime and kept in `sessionStorage`.

### Edge (`edge-simulator/.env`, or `/etc/agrisense/edge.env` on the Pi)

`AGRISENSE_MODE`, `AGRISENSE_API_URL`, `AGRISENSE_DEVICE_ID` (a UUID), `AGRISENSE_DEVICE_KEY` (one of the
backend's `DEVICE_API_KEYS`), `AGRISENSE_INTERVAL`, `AGRISENSE_DATA_DIR`, `AGRISENSE_MAX_PENDING`,
`AGRISENSE_KEEP_SENT_HOURS`, `AGRISENSE_SENSOR` (`bme280`, `dht22` or `none`), `AGRISENSE_I2C_BUS`,
`AGRISENSE_BME280_ADDRESS`, `AGRISENSE_DHT_PIN`, `AGRISENSE_RESOLUTION`. See
[edge-simulator/.env.example](edge-simulator/.env.example).

Generate keys with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## Supabase setup

1. Create a **test** project first.
2. Open **SQL Editor**, then paste and run [supabase/schema.sql](supabase/schema.sql). It is safe to re-run and
   upgrades a v1 install. It only adds things, with two exceptions: it makes the `trap-images` bucket
   **private**, and it replaces the old non-unique `pest_detections_telemetry_idx` index with a unique one.
3. Put `SUPABASE_URL` and the **service_role** key into `backend/.env`, then restart the backend.
4. Run `npm run verify:supabase` (read-only), then `npm run verify:supabase -- --write`. The second command
   inserts one test capture twice to prove idempotency.

What the schema sets up:
- **Row Level Security** is on for every table with no policies, so the anon and authenticated roles can't
  read or write anything. Only the backend's service role can.
- **`ingest_capture(p_telemetry, p_detection)`** writes the telemetry and detection rows in one transaction,
  `ON CONFLICT (capture_id) DO NOTHING`. Only `service_role` can execute it.
- **Constraints**: unique `capture_id`, unique `pest_detections.telemetry_id`, range checks on readings,
  and allowed values for `status`, `battery_source` and `data_source`.
- **Images** are stored at `captures/<device_id>/<capture_id>.<ext>` in a private bucket (upsert, so a retry
  overwrites the same object). The dashboard gets signed URLs that expire.

## Advisory LLM configuration (Gemini or Claude)

**Gemini (default once a key is set):**
1. Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Paste it into `GEMINI_API_KEY` in `backend/.env` and restart the backend.
3. Run `npm run verify:gemini`. It checks that `GEMINI_MODEL` (default `gemini-3.8-flash`, Google's recommended
   Flash model as of Oct 2026) is available to your key, which doesn't generate any content.
4. Run `npm run verify:gemini -- --live` to send one real advisory request (uses your quota).

The integration uses the official `@google/genai` SDK: `models.generateContent` with `systemInstruction`,
`responseMimeType: application/json` and `responseJsonSchema`, plus an HTTP timeout and bounded retries.
A blocked prompt (`promptFeedback.blockReason`) or a safety stop is recorded as `refusal`, and
`MAX_TOKENS` as `truncated`. An invalid key is reported as `auth_error`.

**Claude (optional):** set `ANTHROPIC_API_KEY`, and `ADVISOR_PROVIDER=claude` if a Gemini key is also set.
Check it with `npm run verify:claude`. It uses the official `@anthropic-ai/sdk` with schema-constrained
output.

**Shared by both providers:**
- **Re-validation**: the model's JSON is checked again before saving: an enum risk level and confidence,
  length limits, no extra fields, and dose-like phrases (for example "2 ml/L") replaced with "the product
  label rate".
- **The prompt** contains only validated data: per-class counts, confidence stats, capture time, the readings
  (or "not measured"), the last 5 captures, and whether the data is simulated. It tells the model to flag thin
  evidence, never give doses or brands, and recommend scouting before treatment.
- **Failures**: authentication, rate limit, timeout, network, 5xx, unknown model, refusal or block,
  truncation, bad JSON or a schema violation. The capture is still saved, and the advisory comes from the
  rule engine, stored as `status: fallback, degraded: true, error: {provider, code}`. The dashboard shows it
  as, for example, "Rule engine (Gemini failed: rate_limited)".
- **No automatic switching** to another model or provider.

## Vision provider configuration

**Roboflow** (default): the yellow-sticky-trap model `yellow-sticky-traps-bwxut-ieond/1` on
`https://serverless.roboflow.com`. Only the key is required:

```
VISION_PROVIDER=roboflow
ROBOFLOW_API_KEY=<roboflow api key>   # main name; YOLO_API_KEY still works as a fallback
# optional: ROBOFLOW_MODEL=<project>/<version>, ROBOFLOW_API_URL=<host or full model URL>
```

- The key is sent as Roboflow's `api_key` parameter, from the backend only. It is never logged, stored or
  returned; `/api/health` shows only which env var NAME supplied it.
- **Classes:** the model's labels `WF` (whitefly, pest), `MR` (Macrolophus, predator) and `NC`
  (Nesidiocoris, predator) are mapped through `backend/config/pests.json`. Every detection stores
  `counts` per class and `vision_meta.totals` = `{pests, predators}`, which feed the decision engine.
- **Tiling (SAHI):** whiteflies are a few pixels wide on a phone photo, and the model sees 640 px. Uploaded
  photos therefore get one full-image pass **plus** a `VISION_TILES` x `VISION_TILES` grid (default 4x4)
  of tiles with `VISION_TILE_OVERLAP` (0.2) overlap. Tile boxes are mapped back to the whole photo, and
  duplicates are merged per class (IoU >= 0.5, or a box mostly inside another, which catches insects cut
  at a tile edge). Tiles are never smaller than 640 px, so smaller photos use fewer tiles. Each request
  is downscaled to at most 1280 px to keep uploads fast. **Cost:** a 4x4 photo is 17 Roboflow calls.
  URL images (`?image=<url>`) are sent once, untiled.
- **Photo quality check** (`VISION_QUALITY_CHECK=true`): before detection, every uploaded photo is
  checked for **blur** (variance of the Laplacian, normalised for exposure), **dark** and **overexposed**
  (mean brightness) and **glare** (share of near-white pixels). A photo that fails is not sent to the model
  and gets no demo counts. It is stored as `failed` with `error.code = poor_image` and the metrics in
  `vision_meta.quality`, and the trap shows **■ CHECK TRAP** with what is wrong and how to retake it
  (e.g. "too blurry ... hold the phone steady about 30 cm from the card"). The thresholds are in
  `backend/config/pests.json` → `image_quality` and are **placeholders**, calibrated only on synthetic
  cards (sharp about 90, slightly soft about 40, blurred below 5), so tune them on real photos.
- **Annotated image:** for uploaded photos the API response includes `annotated_image` (a JPEG data URL
  with pests boxed in red and predators in green). It is returned to the uploader and not stored, because
  the dashboard draws boxes itself.
- **Demo fallback** (`VISION_DEMO_FALLBACK=true`, the default): with no key, or when Roboflow fails, the
  photo is counted by the labelled **demo detector**. Its status is `simulated`, `vision_meta.fallback` says
  why, there are no boxes on the real photo, the annotated image carries a "DEMO DETECTOR" banner, and the
  dashboard shows a *Simulated data* banner. Set it to `false` in the field: a failure is then stored as
  `failed` and the trap shows ■ CHECK TRAP.
- **Live check, 2026-11-03:** on a synthetic 2600x1950 card, the full pass plus 4x4 tiles found 48
  whiteflies (47 with the full image only) in about 4 s. Thresholds and tiling should be re-checked on
  real IIHR trap photos.

**Generic** endpoint: `POST` either `{"image_url"}` or `{"image_base64", "content_type"}`, and return
`{"detections":[{"label","confidence","bbox":[x1,y1,x2,y2]}], "image_width"?, "image_height"?}`. Without
the image size, the coordinates must already be normalized.

All boxes are validated: finite numbers, confidence between 0 and 1, sensible labels, and at least partly
inside the image (partly-outside boxes are clipped). Rejected boxes are counted in `vision_meta.rejected`.
An empty result is stored as **zero detections**. With the demo fallback off, a failed call is stored as
`failed`, with no boxes and no advisory. Check with
`npm run verify:vision -- --image path/to/trap.jpg`.

---

## API reference

All errors use one shape: `{ "error": "message", "code": "machine_code", "details"?: {}, "request_id": "..." }`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | – | Mode, store, integration states, auth requirement, threshold. No secrets |
| GET | `/api/ready` | – | 503 if the database is unreachable |
| POST | `/api/telemetry` | device or admin key | Ingests a capture. 201 if new, 200 with `duplicate:true` on a retry |
| GET | `/api/telemetry?device_id=&limit=50&before=ISO` | – | History, oldest first, max 500, `before` pages back |
| GET | `/api/telemetry/latest?device_id=` | – | Latest capture |
| GET | `/api/devices` | – | Device list |
| POST | `/api/devices` | admin | `{name}` |
| PATCH | `/api/device/battery` | admin | `{device_id, battery_level 0-100}`, stored as `manual` |
| GET | `/api/mock-trap/:seed.svg?d=0..1` | – | Synthetic trap image |
| GET | `/api/weather?device_id=` or `?lat=&lon=` | – | Open-Meteo: `spray.can_spray_now`, `spray.checks`, `spray.next_window`, `degree_days`, `current`, `next_24h`. Always 200 (`available:false` when unreachable) |
| POST | `/api/check` | – | Phone check: `{image_base64, days_hung (1-30), temperature?, humidity?}` -> `counts, totals, per_day, decision, advisory, quality, annotated_image, vision`. Not stored; rate-limited |
| POST | `/api/admin/demo/reset` | admin | Re-seed the 4 DEMO traps (14 days, simulated). `DELETE /api/admin/demo` removes them; `GET /api/demo` lists them |
| GET | `/api/admin/telegram` (+ `/preview`, `/chats`) | admin | Telegram status (no token), summary preview, chats that messaged the bot |
| POST | `/api/admin/telegram/test`, `/api/admin/telegram/summary` | admin | Send a test message / the trap summary now |
| GET | `/api/actions?device_id=` | – | Action log, newest first (needs schema v4) |
| POST | `/api/actions` | admin | `{device_id, action: sprayed|released|not_yet, note?, acted_at?}`; stores the advice at the time |
| DELETE | `/api/actions/:id` | admin | Undo an entry |
| GET | `/api/impact?days=30` | – | Impact ESTIMATE vs calendar spraying over all traps: sprays avoided, %, litres, cost, biocontrol releases, assumptions |
| GET | `/api/decision/simulate?pests=&predators=&confidence=` | – | What-if: the same decision engine on hypothetical per-day averages (nothing stored) |
| GET | `/api/decision/regions?max_pests=&max_predators=&steps=` | – | Decision map: grid of decisions over pests/day x predators/day |
| GET | `/api/decision?device_id=` | – | Current predator-aware decision for one trap: `decision, label, reason, avg_pests, pests_per_predator, range, borderline, window, thresholds, days` |
| GET | `/api/map-data?days=14` | – | One row per trap per day: `trap_id, trap_name, latitude, longitude, date, pest_count, predator_count, decision` (plus `dominant_pest, simulated, source`), with `meta` |
| POST | `/api/admin/map-seed` | admin | `{traps, observations}`. Simulated data only; decisions computed server-side |
| DELETE | `/api/admin/map-seed` | admin | Removes all simulated traps and their observations |
| PATCH | `/api/device/location` | admin | `{device_id, latitude, longitude}` (both `null` to clear) puts a real trap on the map |

Example `POST /api/telemetry` request:

```json
{
  "capture_id": "7d0f3c1e-2b9a-4c7e-9f61-0a3b5d2c8e14",
  "device_id": "11111111-1111-4111-8111-111111111111",
  "timestamp": "2026-10-29T08:00:00Z",
  "temperature": 26.4,
  "humidity": null,
  "data_source": "hardware",
  "image_base64": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

Field rules:
- `temperature` must be between −40 and 85 °C and `humidity` between 0 and 100 %. `null` or a missing field
  means "not measured", and 0 is a valid reading. Out-of-range values return **422**; they are never clamped.
- Send either `image_url` or `image_base64`, not both.
- A capture needs an image or at least one reading.

Example response, abridged:

```json
{
  "duplicate": false,
  "telemetry": {
    "id": 42, "capture_id": "7d0f…", "temperature": 26.4, "humidity": null, "data_source": "hardware",
    "image_path": "captures/1111…/7d0f….jpg", "image_url": "https://…signed…",
    "detection": {
      "pest_counts": {"aphid": 12, "whitefly": 4, "thrips": 0, "fungus_gnat": 0},
      "bounding_boxes": [{"label": "aphid", "confidence": 0.91, "x": 0.41, "y": 0.22, "width": 0.02, "height": 0.02}],
      "vision_meta": {"status": "ok", "source": "yolo", "provider": "roboflow", "model": "pests/3",
                      "image": {"width": 1920, "height": 1080}, "rejected": 0, "error": null},
      "ai_advisory": {"risk_level": "Medium", "confidence": "Low", "summary": "…", "recommendation": "…",
                      "mitigation_strategy": ["…"], "source": "gemini", "status": "ok", "model": "gemini-3.8-flash"}
    }
  },
  "sources": {"vision": "ok", "advisory": "gemini", "advisory_status": "ok", "store": "supabase"}
}
```

### Error codes

| HTTP | code | Meaning and what to do |
|---|---|---|
| 400 | `invalid_json`, `invalid_body`, `invalid_device_id`, `invalid_capture_id`, `invalid_temperature`, `invalid_image`, `invalid_image_url`, `ambiguous_image`, `invalid_data_source` | Fix the request |
| 401 / 403 | `unauthorized` / `forbidden` | Missing or wrong key |
| 403 | `device_mismatch` | A device-bound key was used for another `device_id` |
| 403 | `cors_rejected` | Add the dashboard origin to `CORS_ORIGINS` |
| 404 | `device_not_found`, `route_not_found`, `no_telemetry` | |
| 409 | `capture_id_conflict` | The same `capture_id` was used by another device |
| 413 | `image_too_large`, `payload_too_large` | Lower the camera resolution or raise `MAX_IMAGE_BYTES` |
| 415 | `unsupported_image_type` | Only JPEG, PNG and WebP are accepted |
| 422 | `sensor_out_of_range`, `empty_capture`, `invalid_battery_level`, `invalid_timestamp` | The edge marks these as dead, not retried |
| 429 | `rate_limited` | Honour `Retry-After` |
| 502 | `image_upload_failed` | Storage failed and nothing was saved. Retry |
| 503 | `database_unavailable` | Nothing was saved. Retry (safe, because of `capture_id`) |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits with `config_invalid` | Read the listed problems. Usually a half-set Supabase config or a missing key with `DEMO_MODE=false` |
| Dashboard shows "Offline" | The backend isn't running, or `VITE_API_URL` / `CORS_ORIGINS` don't match |
| "Admin key required" in Admin tab | Enter `ADMIN_API_KEY` in the key box (it's kept for this browser tab only) |
| Trap image "could not be loaded" | The signed URL expired (refresh), or the stored file isn't a valid image |
| Every capture says "Not analysed" | No `YOLO_API_URL` is set. Only synthetic demo traps get simulated boxes |
| Advisory badge "Gemini failed: auth_error" | Check `GEMINI_API_KEY`, then run `npm run verify:gemini` |
| Advisory badge "Gemini failed: model_not_found" | Pick a model your key can use and set `GEMINI_MODEL` |
| Advisory badge "Gemini failed: rate_limited" | Free-tier quota reached. Slow the simulator down or enable billing |
| Advisory badge "Gemini failed: api_unavailable" | Google-side overload (503/504). Retry later, or switch `GEMINI_MODEL` (e.g. `gemini-3.6-flash` or `gemini-3.5-flash-lite`) |
| `ready:false` from `/api/ready` | Check `SUPABASE_URL` and the service-role key, and that `schema.sql` was applied |
| Edge: `queue {'pending': N}` keeps growing | Backend unreachable or 401. Check `journalctl -u agrisense-edge` |

---

## Automated tests

```bash
cd backend && npm test               # node:test, 51 tests, all providers mocked
cd backend && npm run check          # syntax check of every backend file
cd frontend && npm test              # Vitest + Testing Library (jsdom), 22 tests
cd frontend && npm run build         # production build
cd edge-simulator && python -m unittest discover -s tests -v
```

No test uses real keys or makes a paid call. The backend tests boot the real Express app on a random port,
with an in-memory store and fake vision and Claude clients.

## Raspberry Pi deployment

On Raspberry Pi OS Bookworm (64-bit):

```bash
sudo apt update && sudo apt install -y python3-venv python3-picamera2 git
sudo raspi-config nonint do_i2c 0                        # enable I2C for the BME280
sudo useradd --system --create-home --groups video,i2c,gpio agrisense
sudo mkdir -p /opt/agrisense /etc/agrisense
sudo git clone <your-repo-url> /opt/agrisense/src
sudo ln -s /opt/agrisense/src/edge-simulator /opt/agrisense/edge-simulator
sudo python3 -m venv --system-site-packages /opt/agrisense/venv     # sees apt's picamera2
sudo /opt/agrisense/venv/bin/pip install -r /opt/agrisense/edge-simulator/requirements-pi.txt
sudo cp /opt/agrisense/edge-simulator/.env.example /etc/agrisense/edge.env
sudo nano /etc/agrisense/edge.env      # set AGRISENSE_API_URL, DEVICE_ID, DEVICE_KEY, SENSOR, INTERVAL=300
sudo chown root:agrisense /etc/agrisense/edge.env && sudo chmod 640 /etc/agrisense/edge.env

# One-off hardware self-test (photo + reading, no upload)
cd /opt/agrisense/edge-simulator
sudo -u agrisense env $(grep -v '^#' /etc/agrisense/edge.env | xargs) /opt/agrisense/venv/bin/python simulator.py --mode hardware --probe

sudo cp deploy/agrisense-edge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now agrisense-edge
journalctl -u agrisense-edge -f
```

How the service behaves:
- **Offline**: captures go to `/var/lib/agrisense/queue.db` and are uploaded oldest-first with exponential
  backoff when the network returns.
- **Bounded storage**: `AGRISENSE_MAX_PENDING` caps the queue (at 1080p, roughly 1–2 GB at the default 1000).
  Uploaded images are deleted, and sent records are pruned after 24 hours.
- **Missing readings**: if a sensor read fails, the reading is sent as `null`. Nothing is made up.
- **Startup**: `ExecStartPre` runs `--probe`. The service restarts on failure and gives up after 5 failures
  in 10 minutes.
- **Shutdown**: SIGTERM finishes the current work and exits.
- **Inference stays in the cloud**: the Pi only captures, reads sensors and uploads.

## Deployment (backend and frontend)

The backend and frontend deploy independently. Nothing below has been deployed from this repository.

- **Backend**: any Node 20+ host (Render, Fly.io, Railway or a VM) running `npm ci --omit=dev && npm start`.
  - Set `NODE_ENV=production`, `DEVICE_API_KEYS`, `ADMIN_API_KEY`, `CORS_ORIGINS=<dashboard origin>`,
    `PUBLIC_BASE_URL`, the Supabase variables, and `TRUST_PROXY=true` behind the platform proxy.
  - Use `/api/ready` as the health check.
  - Run a single instance: the rate limiter is in-memory.
- **Frontend**: `VITE_API_URL=https://<api> npm run build`, then serve `frontend/dist` from any static host.
  `dist/_headers` sets a strict Content-Security-Policy on Netlify and Cloudflare Pages; set the same headers
  on other hosts. `npm run preview` (port 4173) serves the build locally with the CSP applied.
- Serve both over HTTPS. The device and admin keys are bearer tokens.

## Real integration checklist

Do these in order, each on its own. Use a Supabase **test** project.

1. **Gemini**: set `GEMINI_API_KEY` and restart the backend, then:
   - Run `npm run verify:gemini`. It should print `PASS model available`.
   - Run `npm run verify:gemini -- --live`. It should print `PASS real Gemini advisory`.
   - Send one capture from the dashboard. The advisory badge should say "Gemini · gemini-3.8-flash".
   - Temporarily set a wrong key. The advisory should show "Rule engine (Gemini failed: auth_error)".
2. **Vision**: set `YOLO_API_URL`, `YOLO_API_KEY` and `VISION_MODEL_ID`, then:
   - Run `npm run verify:vision -- --image trap.jpg`.
   - Count the insects on that image by hand and compare. Don't quote accuracy without a labelled set.
   - Run `python simulator.py --image trap.jpg --once`, then check in the dashboard that the boxes sit on the insects.
3. **Supabase**: run `schema.sql`, set the URL and service-role key, then:
   - Run `npm run verify:supabase`.
   - Run `SUPABASE_ANON_KEY=<anon> npm run verify:supabase` (in your shell, not `.env`). It should print `PASS anon key cannot read`.
   - Run `npm run verify:supabase -- --write`.
   - Restart the backend. The captures should still be there.
4. **Auth**: set `DEMO_MODE=false` and both keys. The simulator without a key should log a 401, and with
   `AGRISENSE_DEVICE_KEY` it should upload.
5. **Full system**:
   - Start the backend, frontend and `python simulator.py --interval 5`.
   - Stop the backend for a minute. `--status` should show pending captures.
   - Restart the backend. The queue should drain, and the dashboard should show each capture once.
   - Set the battery to 14% and check that the alert appears.
6. **Pi hardware**: run `--probe`, then the systemd service. Pull the network cable for 10 minutes and plug it
   back in. Nothing should be lost.

## Security considerations

- Device and admin keys are compared in constant time, and a device key can't be used on admin endpoints.
  A device key written as `<device-uuid>:<key>` can only submit data for that device.
- The API sends `Content-Security-Policy: default-src 'none'`, and the built dashboard has a strict CSP
  (see `frontend/public/_headers`).
- Keys are bearer tokens: rotate them by editing the env and restarting.
- The service-role key never leaves the backend. RLS blocks anon access, and images are private, shared
  through signed URLs.
- Read endpoints (`GET /api/telemetry`, `/api/devices`) are **public**. Anyone who can reach the API can read
  the trap data. Put the dashboard and API behind your platform's access control if that matters.
- Logs are structured JSON with no headers, bodies or secrets, and fields that look like credentials are
  redacted.

## Known limitations

- Gemini, Claude, the vision provider, Supabase and the Pi hardware drivers are **not verified against real
  services or devices** yet. They are only tested with mocks.
- The Roboflow base64 body format follows Roboflow's long-standing convention but isn't spelled out on its
  current docs page. Confirm it with `verify:vision`.
- There is no measured detection accuracy: that needs a labelled evaluation set.
- Battery level is set manually. No battery or UPS sensor is integrated.
- The in-memory demo store keeps uploaded images as data URLs and loses everything on restart.
- The rate limiter is per-instance and the dashboard updates by polling (every 5 s).
- **Map:**
  - It runs on kepler.gl **3.3.0-alpha.18**, a pre-release (the stable 3.2.x needs React 18).
  - kepler.gl adds **14 critical and 19 high** `npm audit` findings that can't be fixed from
    this project. Exposure and mitigations are in DECISIONS.md (D12).
  - The SPRAY / BIOCONTROL / WAIT thresholds are illustrative, not validated.
  - The Mapbox satellite style hasn't been tested with a real token.
- There are no per-user dashboard accounts.
