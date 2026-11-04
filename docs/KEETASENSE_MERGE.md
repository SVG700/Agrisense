# KeetaSense ideas in AgriSense: summary, demo, judge script, to-do

Branch `feature/keetasense-merge` (one commit per feature, on top of `main`). KeetaSense's best ideas
were rebuilt in AgriSense's own stack (Express + Supabase + React); no KeetaSense code was copied.

## 1. What was built

| # | Feature | Where to see it | Commit |
|---|---|---|---|
| 2 | **Predator-aware decision engine**: 3-day average; at least 25 pests/day with at least 10 pests per predator → SPRAY; at least 25/day with fewer → RELEASE BIOCONTROL; under 25/day → WAIT. Every decision has a plain reason, a count range and a BORDERLINE tag. Thresholds are in `backend/config/pests.json`, marked *placeholder - to confirm with IIHR mentor*. Gemini explains the decision; it never makes its own. | Advisory card, map, every page | `db2f04d` |
| 4 | **Traffic-light UI**: ▲ SPRAY red, ◆ RELEASE BIOCONTROL amber, ● WAIT green, ■ CHECK TRAP grey (shape + colour + words). Trap cards on the dashboard. | Farmer Analytics, map | `616eb3f` |
| 6 | **Demo mode**: 4 DEMO traps × 14 days, one per state. One-click reset; *Simulated data / Demo detector* labels. | Admin → Demo mode, or `npm run demo:reset` | `6a7ce22` |
| 1 | **Roboflow detection**: `yellow-sticky-traps-bwxut-ieond/1`; WF / MR / NC mapped in config; full-image pass + 4×4 SAHI tiles with seam de-duplication; totals and an annotated image; labelled demo fallback. | Uploads, Phone Check | `d7fc146` |
| 3 | **Photo quality gate**: blurry / dark / overexposed / glare → not counted, ■ CHECK TRAP with retake advice. | Dashboard badges, Phone Check | `396f38c` |
| 5 | **Phone Check**: photo + days the card hung → counts, per-day rate, decision, advice, annotated photo. Nothing is stored. | Check tab | `5e1c54c` |
| 7 | **Weather**: Open-Meteo (free, no key). *Can I spray now?* (rain in the next 6 h, wind, daylight) with the next good window, and whitefly degree-days. | Farmer Analytics | `706fd35` |
| 9 | **What-if simulator** on the same engine, with a decision map. | Farmer Analytics | `c424235` |
| 12 | **Impact ESTIMATE**: sprays avoided vs calendar spraying, litres, ₹, biocontrol releases. | Farmer Analytics | `dfb8d7f` |
| 10 | **Action log**: Sprayed / Released / Not yet, with the advice at the time, and chart markers. *Needs schema v4.* | Farmer Analytics | `4cbb3b4` |
| 8 | **Telegram**: daily summary + instant alerts, English + ಕನ್ನಡ. | Admin → Telegram alerts | `9bc07f4` |
| 13 | **EN / ಕನ್ನಡ** toggle on the dashboard, trap cards and Phone Check (map/admin stay English). | Header switch | `c27755a` |

Skipped as agreed: #11. #14 is listed below (not built).

Tests at the end: **107 backend + 42 frontend, all passing**; the frontend build passes.

## 2. How to run the demo

```bash
cd backend && npm run dev          # http://localhost:4000
```
```bash
cd frontend && npm run dev         # http://localhost:5173
```
```bash
cd backend && npm run demo:reset   # fresh 14 days of DEMO data ending now (run before every presentation)
```

1. Open http://localhost:5173. If asked, enter the admin key in *Admin & Hardware Control*.
2. **Farmer Analytics.** The trap cards show all four states. Click **DEMO · Polyhouse 2** to load it.
3. Scroll to **What if…?**: try *After a spray* and *Pests double*.
4. **Can I spray now?** and **Estimated impact** are on the same page.
5. **Check** tab: upload a sticky-card photo, set the days, press *Check trap*. A blurry photo shows CHECK TRAP.
6. **EN / ಕನ್ನಡ** switch (top right) on Analytics or Check.
7. Optional: *Admin → Telegram alerts → Preview summary* (or *Send summary now* once the bot is set up).

The traps turn grey (CHECK TRAP) 48 h after the last reset, so reset on the day of the demo.

## 3. 60-second judge script

> **(0-10 s) Problem.** "Farmers here spray on a calendar, every week, whatever is on the trap. That costs
> money, and it kills the predator bugs - Macrolophus, Nesidiocoris - that IIHR releases to control
> whitefly for free."
>
> **(10-25 s) The predator-aware decision.** *Point at the trap cards.* "Polyhouse 1 and Polyhouse 2 both
> catch around 50 to 65 whiteflies a day. A count-only system says *spray both*. AgriSense says ▲ SPRAY
> for Polyhouse 1 but ◆ RELEASE BIOCONTROL for Polyhouse 2, because its camera also counts predators:
> about 4 pests per predator there against 99 in Polyhouse 1. Its natural enemies are winning, so we
> protect them instead of spraying."
>
> **(25-35 s) Same engine, live.** *What if…? on Polyhouse 2: drag predators down.* "Remove the predators
> and the same rule flips to SPRAY. *After a spray*, it's WAIT. Every answer explains itself, and BORDERLINE
> warns when the count is too close to call."
>
> **(35-45 s) Phone check.** *Check tab, upload a card photo.* "No device? Photograph the card. Roboflow
> counts whiteflies and predators in tiles, so tiny insects aren't missed. You get the advice in seconds.
> A blurry photo gets *retake it*, not a wrong answer."
>
> **(45-55 s) When, and what it saves.** "*Can I spray now?* says not now, rain is due, and gives the next
> good window. Alerts go to Telegram in Kannada. Our *estimate* on demo data is about half the sprays of
> calendar spraying."
>
> **(55-60 s) Honest.** "All thresholds are placeholders we will confirm with our ICAR-IIHR mentor, and
> simulated data is always labelled as simulated."

## 4. New env variable names (backend/.env; values are yours)

All optional. Nothing is required for the demo.

| Name | Purpose |
|---|---|
| `ROBOFLOW_API_KEY` | Roboflow key (main name; your existing `YOLO_API_KEY` still works as fallback) |
| `ROBOFLOW_MODEL`, `ROBOFLOW_API_URL` | Other model / host (defaults are the sticky-trap model) |
| `VISION_TILES`, `VISION_TILE_OVERLAP` | SAHI grid (default 4 × 4, 0.2) |
| `VISION_DEMO_FALLBACK` | `true` = labelled demo counts when the model is unavailable; set `false` in the field |
| `VISION_QUALITY_CHECK` | Photo quality gate (default on) |
| `RATE_LIMIT_CHECK_MAX` | Phone checks per window per IP (default 20) |
| `WEATHER_ENABLED`, `WEATHER_DEFAULT_LAT`, `WEATHER_DEFAULT_LON`, `WEATHER_DEFAULT_LABEL`, `WEATHER_CACHE_MINUTES`, `WEATHER_TIMEOUT_MS` | Open-Meteo (no key) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | **Both needed** to switch Telegram on |
| `TELEGRAM_LANGUAGE`, `TELEGRAM_ALERTS`, `TELEGRAM_SUMMARY_TIME`, `TELEGRAM_TIMEZONE`, `TELEGRAM_TIMEOUT_MS`, `DASHBOARD_URL` | Telegram options (`both`, on, 07:00, Asia/Kolkata) |
| `TELEGRAM_PHOTO_BOT`, `TELEGRAM_BOT_ACCESS`, `TELEGRAM_BOT_MAX_PER_HOUR`, `TELEGRAM_BOT_DEFAULT_DAYS` | Photo bot (on, `chats` = only TELEGRAM_CHAT_ID, 20/h, 7 days) |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE`, `VOICE_MAX_CHARS` | Natural voice for the AI advice (defaults are fine) |

### Telegram photo bot - demo

1. **Put the laptop on mobile data** (the venue Wi-Fi blocks Telegram). The Admin page's
   *Photo bot* card turns to **Listening for photos** within a few seconds - no restart needed.
2. On the phone, open the bot and send a photo of a yellow sticky card, caption `7`
   (days it hung). Within ~10-20 s the bot replies with the traffic-light decision, insects
   counted and per day, predators, why, and 3 things to do - then the photo with every insect marked.
3. Commands: `/days 7` (default days for this chat), `/lang en|kn|both`, `/help`.
4. A phone that is not in `TELEGRAM_CHAT_ID` gets a polite refusal with its chat id - add it
   (comma-separated) and restart to let that farmer use the bot.

## 5. What you need to do by hand

1. **Supabase - action log table.** Paste `supabase/migrations/v4_action_log.sql` into Supabase → SQL
   Editor → Run. Until then the *What did you do?* card says so; everything else works.
2. **Telegram.**
   1. In Telegram, open **@BotFather**, send `/newbot` and copy the token into `TELEGRAM_BOT_TOKEN`.
   2. Send your bot any message (or add it to your group) and restart the backend.
   3. Go to *Admin → Telegram alerts → Find my chat id*, put the number in `TELEGRAM_CHAT_ID`, and restart.
   4. Press **Send test**. Optionally set `DASHBOARD_URL` to your deployed dashboard.
3. **Before every demo:** `cd backend && npm run demo:reset`.
4. **Roboflow (optional):** add `ROBOFLOW_API_KEY` (your `YOLO_API_KEY` already works). `VISION_MODEL_ID` in
   your `.env` is a label, not a model, and is now ignored, so you can delete it.
5. **Real photos:** run `npm run verify:vision -- --image your-trap.jpg` on a few real IIHR sticky-card photos.
   Whitefly detection was confirmed live; **predators (MR / NC) and the photo-quality thresholds are not yet
   tested on real photos.** The annotated image is written next to the photo.
6. **With the IIHR mentor:** confirm every placeholder in `backend/config/pests.json`: 25 pests/day, 10 pests
   per predator, 3-day window, 48 h CHECK TRAP, image quality, spray-window rules, 10 °C / 300 degree-days,
   and the impact assumptions (7-day calendar, 0.5 acre/trap, 0.25 L and ₹1,500 per acre per spray).
7. **Kannada review** by a native speaker: `frontend/src/lib/i18n.jsx` (`kn`) and
   `backend/src/services/telegram.js` (`TEXT.kn`).
8. **Field use:** set `VISION_DEMO_FALLBACK=false`. Set each real trap's coordinates
   (`PATCH /api/device/location`) for the map and per-trap weather.
9. **When happy:** merge `feature/keetasense-merge` into `main` (ask me and I'll do it).

## 6. #14 - Raspberry Pi gaps (not built)

**Trap-box controls (backend ready, Pi side not built).** The Admin page switches the fan and trap
light and sends Pi commands (`capture_now`, `restart_camera`, `reboot`). The Pi should poll
`GET /api/devices/<id>/commands/pending` (device key) every ~30 s, apply the switches, run each
command, then `POST /api/devices/<id>/commands/ack` with `{command_id, ok, message, switches}`.
Until it does, the dashboard says "waiting for the Pi". State is kept in memory and resets when
the backend restarts.

**Live Vision (backend + dashboard ready, Pi side not built).** Pressing the trap photo (or
"Live Vision") on the dashboard opens the Pi's OpenCV view. While streaming (after a
`start_stream` command, until `stop_stream`), the Pi should send about 1-2 frames a second:

```
POST /api/devices/<id>/vision/frame        (X-Device-Key)
{ "image_base64": "<jpeg>",                 # max 2 MB; ~960 px wide is plenty
  "stages": [{ "name": "Yellow mask", "image_base64": "<jpeg>" }],   # up to 4 OpenCV steps
  "boxes": [{ "x": 0.1, "y": 0.2, "width": 0.03, "height": 0.03, "label": "whitefly", "confidence": 0.9 }],
  "fps": 12.5, "width": 1280, "height": 960,
  "pipeline": ["Picamera2 capture", "HSV yellow-card mask", "contours"] }
```

Boxes are relative (0-1), like the vision model's. A frame older than 10 s counts as "not
streaming", and the dashboard then shows a clearly labelled preview of the last capture instead.

The edge client already has Picamera2 capture, a BME280 / DHT22 sensor, a durable offline queue and
idempotent uploads with backoff. To use it as a field trap with these features:

1. **Cumulative card counts - most important.** A sticky card keeps every insect until it is changed, but
   the engine reads each day's count as that day's catch. Add a *new card* event (a button or app action:
   `card_installed_at`) and compute **daily increments**. Phone Check already does this (total ÷ days hung).
2. **Camera resolution and focus.** The default is 1920×1080, too small for whiteflies and too small for
   4×4 tiles. Use 4608×2592 (Camera Module 3) or 4056×3040 (HQ), with fixed or locked autofocus at the
   card distance, and locked exposure / white balance.
3. **Mounting and light.** A fixed jig at a set distance, a diffuse LED ring for consistent light, and a
   polariser or angle to stop glare on the shiny card (the quality gate will otherwise reject photos).
4. **On-device quality check.** Run the blur / dark / glare check on the Pi and re-shoot before uploading,
   to save data and avoid CHECK TRAP.
5. **Upload size.** Downscale to at most 2600 px on the Pi (as Phone Check does) to cut mobile-data costs.
6. **Real battery reading.** Hardware mode sends no battery level today. Add a UPS HAT / INA219 fuel gauge.
7. **Power and schedule.** Capture 2-3 times a day instead of every few seconds, and add solar plus
   sleep / wake (Witty Pi or similar).
8. **Heartbeat.** Send a small "alive" ping so CHECK TRAP can tell "device offline" from "photo missing".
9. **Location.** The Pi does not send coordinates. Set them once per trap, or add GPS.
10. **Time.** Make sure NTP is synced: captures are timestamped on the device and the decision uses UTC days.
11. **Provisioning and security.** One device key per trap (`DEVICE_API_KEYS`), key files readable only by
    the service user, and an optional read-only root filesystem.
12. **Enclosure and heat.** A weatherproof, ventilated case; polyhouses pass 40 °C and the Pi throttles.
13. **Remote updates and config.** OTA updates of the edge client and remote interval / threshold changes.
14. **Model check on Pi images.** Validate WF / MR / NC detection on photos from the actual Pi camera,
    because predators are small and the training photos came from other cameras.
