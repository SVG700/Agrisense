# Draft roadmap issues

Draft GitHub issues for the roadmap, taken from the README's "Real integration checklist" and
"Known limitations" and from `DECISIONS.md`. **None of these have been created.** Copy each one
into a new issue (title, body, labels) when you're ready.

Labels used: `bug`, `enhancement`, `good first issue`, `hardware`, `help wanted`, `docs`. Create any
that don't exist yet under **Issues → Labels**. The field report template also uses `field report`.

---

## 1. Verify Gemini advisory against the live API

**Labels:** `enhancement`, `help wanted`

Gemini is only tested against mocks (README, Known limitations). Follow step 1 of the README's
"Real integration checklist":

- `npm run verify:gemini` prints `PASS model available`.
- `npm run verify:gemini -- --live` prints `PASS real Gemini advisory`.
- A dashboard capture shows the "Gemini · <model>" badge.
- A wrong key falls back to "Rule engine (Gemini failed: auth_error)".

Record the results (no keys!) in `docs/REPORT.md`.

## 2. Verify the Roboflow vision integration and its base64 body format

**Labels:** `enhancement`, `help wanted`

The Roboflow base64 body follows Roboflow's long-standing convention but isn't spelled out on its
current docs page. Run `npm run verify:vision -- --image trap.jpg`. Hand-count the insects on the
same image and compare. Check that the boxes sit on the insects in the dashboard. Update the README
with what was confirmed.

## 3. Build a labelled sticky-trap evaluation set and measure accuracy

**Labels:** `enhancement`, `help wanted`

There is no measured detection accuracy. We need a labelled set of yellow sticky-trap photos
(whitefly, Macrolophus, Nesidiocoris, others) with a documented licence, plus a script that reports
precision / recall / count error per class. Until then, the app must not quote accuracy (honesty
rule).

## 4. Validate decision thresholds with ICAR-IIHR

**Labels:** `enhancement`, `help wanted`

The SPRAY / BIOCONTROL / WAIT thresholds in `backend/config/pests.json` (≥ 25 pests/day, ≥ 10 pests
per predator) are marked **PLACEHOLDER** (DECISIONS.md D7). Get validated economic thresholds per crop
and pest from the ICAR-IIHR mentor or the literature, cite the source next to each value, and update
the tests. Needs maintainer review (safety-related).

## 5. Native-speaker review of the Kannada translations

**Labels:** `help wanted`, `good first issue`

The Kannada text in `frontend/src/lib/i18n.jsx` and the Telegram messages is a first draft. A native
speaker (ideally with farming vocabulary) should review every string and suggest corrections. Advice
wording changes need maintainer review.

## 6. Run the Supabase verification on a test project

**Labels:** `enhancement`, `docs`

Follow step 3 of the integration checklist on a Supabase **test** project:

- Apply `schema.sql`.
- `npm run verify:supabase` passes.
- With the anon key, it prints `PASS anon key cannot read`.
- `--write` passes.
- Captures survive a backend restart.

Document the outcome.

## 7. Pi hardware soak test: offline queue under network loss

**Labels:** `hardware`, `help wanted`

Step 6 of the checklist: run `--probe`, then the systemd service on a Raspberry Pi 5 with the camera
and a BME280. Unplug the network for 10 minutes, reconnect, and confirm nothing is lost or duplicated.
Report queue counts, timings and any errors.

## 8. Integrate a real battery / UPS sensor

**Labels:** `hardware`, `enhancement`

The battery level is set manually (README, Known limitations; battery portal). Add support for a
battery or UPS HAT on the Pi so readings are labelled `device` instead of `manual`, with a low-battery
alert. Never invent a value when the sensor is missing.

## 9. Move the map off the kepler.gl pre-release

**Labels:** `enhancement`

The map runs on kepler.gl `3.3.0-alpha.18` (DECISIONS.md D1), which brings 14 critical and 19 high
`npm audit` findings that we can't fix (D12). When a stable 3.3.x ships:

- Upgrade.
- Re-check the deck.gl / luma.gl `overrides` (D3) and the `assert` shim (D4).
- Re-run `npm audit`.
- Re-test the map in the browser.

## 10. Test the Mapbox satellite basemap with a real token

**Labels:** `good first issue`, `docs`

The satellite style (`VITE_MAPBOX_TOKEN`, DECISIONS.md D6) has never been tested with a real token.
Create a URL-restricted `pk.` token and check the satellite style loads under the CSP. Fix and
document anything that breaks.

## 11. Per-user accounts for the dashboard

**Labels:** `enhancement`

There are no per-user dashboard accounts, and read endpoints are public (README, Security
considerations). Design simple per-farm access, for example Supabase Auth with row-level security per
farm, without breaking demo mode. Discuss the design in the issue first.

## 12. Replace 5-second polling with push updates

**Labels:** `enhancement`

The dashboard polls every 5 s and the rate limiter is per-instance (Known limitations). Evaluate
Server-Sent Events or Supabase Realtime for new captures, keeping polling as a fallback.

## 13. Obtain and document the AgroPest-12 weights and their licence

**Labels:** `enhancement`, `docs`, `help wanted`

The intended AgroPest-12 YOLOv8s weights aren't available yet. The experimental pest29 model scores
mAP@50 0.25 (inference-service README). Obtain or train the AgroPest-12 weights, record the dataset
and weight licences (Ultralytics is AGPL-3.0, see THIRD_PARTY_NOTICES.md), and publish validation
metrics. Weights stay out of git.

## 14. Shared rate limiter for multi-instance deployments

**Labels:** `enhancement`

The rate limiter is in memory, so the README says to run a single backend instance. Add an optional
shared store (for example Redis or Postgres), keeping the in-memory default for demos.

## 15. Collect field reports from pilot farms

**Labels:** `help wanted`, `docs`

Recruit a few farmers or extension workers to hang traps and file **Field report** issues (region,
crop, trap type, days hung, photos, what the app advised, what happened). Summarise what we learn in
`docs/` and turn the findings into issues.
