# AgriSense AI: QA audit (report only, nothing changed yet)

Date: 2026-11-04 · Branch: `feature/acreflow-redesign` · Scope: every page (Dashboard, Phone Check, Pest Surveillance Map, Admin & Hardware), the overlays, the light and dark themes, desktop and narrow widths, build, tests, i18n, accessibility and contrast.

**Overall:** everything works. Tests pass (frontend 64, backend 138, edge 22, plus 6 more on the Pi). The console shows no errors except the Gemini TTS quota (429). There is no horizontal overflow at narrow widths. The dark theme has 0 contrast failures. The findings below are polish items: consistency, translation gaps, small sizes and a few confusing texts.

Severity: **P1** = visible to farmers or judges, or wrong information · **P2** = inconsistency or polish · **P3** = code hygiene, no visible effect.

---

## P1: fix first

| # | Where | Problem | Proposed fix |
|---|---|---|---|
| 1 | Admin → Battery vs Dashboard → Trap Health / trap picker | Greenhouse A shows **Battery 92%** on the dashboard and in the trap picker, but Admin says **"Not reported"** for the same trap. The 92% comes from older simulated captures; the Pi sends `battery_level: null`. | Show "Not reported" (or "—") everywhere when the latest capture has no battery value. Never carry forward an old simulated number. |
| 2 | Map → warning banner (`backend/src/routes/map.js:254`) | Shown to farmers: *"1 trap(s) have no coordinates and are not shown - set them with PATCH /api/device/location"*. This is developer text, and "trap(s)" reads awkwardly. | "1 trap has no location yet, so it isn't on the map. Set it in Admin." Pluralise properly. |
| 3 | Map empty state (`map/PestMapPage.jsx:175`) | Mentions `PATCH /api/device/location` and `python demo/seed.py`. | Use farmer wording; keep the commands only in the docs. |
| 4 | Map → `/api/map-data?days=14` | Takes **~16 s** to respond. "Loading trap data…" and "No observations." show **at the same time** while it loads. | Hide "No observations" while loading (show a skeleton); speed up or cache the query. |
| 5 | Map → "Traps mapped **22**" / "22 traps · 218 trap-days" | The trap picker lists **5** traps, but the map counts 22. Old test or seed devices are still in the database. | Count only active devices, or clean up the stale rows (`npm run demo:reset` before the demo). |
| 6 | Map legend | Lists SPRAY / RELEASE BIOCONTROL / WAIT but **not CHECK TRAP**, which the app also uses. | Add a CHECK TRAP legend entry. |
| 7 | `i18n.jsx:227` `weather.none` | "No good window in the next **3 days**", but the forecast now shows **7** days. | "No good spray window in the next 7 days". |
| 8 | `i18n.jsx:36` `hero.noCapture` | Says "the **Hardware tab**", but the nav is "**Admin & Hardware**". | "…or from Admin & Hardware". |
| 9 | Light theme contrast (WCAG AA 4.5:1) | 8 failures. Worst are the Microclimate legend: "Insects trapped" lime **1.51:1**, "Humidity (%)" sky **2.14:1**, "Temperature (°C)" orange **2.8:1**. Just below the limit: ▲SPRAY badge 4.29, "Readings: Sensor" 4.30, "30d" 4.44, "Detections: Photo rejected" 4.46, "Photo: blurry - retake" 4.46. | Keep the coloured dot or line and use dark ink for the legend text. Darken the badge text one step. |
| 10 | Tiny text | The Pest pressure "↘20%" pill is **8 px**; chart axis labels are 9 px; BORDERLINE is 9.6 px; "Ctrl K" and the forecast labels are 10 px. | Minimum 11 px, and 12 px for anything a farmer must read. |
| 11 | Duplicate heading | "**AI Advisor**" appears twice on the dashboard (the voice card in the hero and the advisory card in Live detections). | Rename the hero one to "Listen to advice" or "AI voice brief". |

## P2: consistency and polish

**Capitalisation (mixed Title Case and sentence case).** Title Case: "Trap Health", "Recent Updates", "Interactive Trap View" (`TrapCanvas.jsx:86`), "Recent Captures" (`FarmerDashboard.jsx:462`), "Microclimate vs Pest Population" (`MicroclimateChart.jsx:66`), "Edge Capture Simulator" (`AdminPanel.jsx:458`), "Event Log" (`AdminPanel.jsx:107`), "Pest Surveillance Map", nav "Admin & Hardware". Sentence case: "Economic impact", "Trap care guide", "Daily timeline", "Species breakdown", "7-day forecast", "Telegram alerts", "Demo mode", and the page heading "Admin & hardware" (`AdminPanel.jsx:50`).
→ Proposal: **sentence case everywhere**, e.g. "Trap health", "Recent updates", "Interactive trap view", "Admin & hardware".

**Wording mismatches**
- "Released predators" (action buttons) vs "**Released biocontrol**" (`DailyTimeline.jsx:10`, `lib/events.js:8`): use one term.
- "pests/day" vs "Pests per day": use one form.
- Forecast footnote says *"Good to spray"* in quotes, while the chips say "No spray hours" and the banner says "Best day to spray". Align the wording.
- Admin has two buttons both called "**Capture now**" (Pi controls and simulator): rename the simulator one to "Send simulated capture".
- "Event Log … 0 events" right under "Actions you take here will be logged." reads like an empty broken box. Hide the box until there is an event.

**Punctuation and typography**
- Plain hyphen " - " used as a dash all over ("Greenhouse A - Trap 01", "Photo: blurry - retake", "Wind 5.4 km/h - low drift", API error texts) → en dash "–" or a middle dot "·".
- Ranges "{lo}-{hi}" → "{lo}–{hi}".
- Spelling mix: British "labour", "Colour" vs American "Customize". Proposal: Indian/British English ("Customise", "colour", "labour") to fit an ICAR-IIHR audience. Or choose American; either way, choose one.

**Number and date formats**
- Mixed: `toLocaleString()` gives "11/3/2026, 9:32:40 PM" (US) (`FarmerDashboard.jsx:165`), the map shows ISO "Pests on 2026-11-04", kepler shows "10/22/2026", while elsewhere it is "4 Nov". → One en-IN format: "4 Nov, 9:32 PM".
- Temperatures shown as both "27.0°C" and "27°C" → no decimal on cards, one decimal only in detail views.

**Brand name**: "Agrisense" in `api.js:2/46/62` and `KeplerView.jsx:65` (visible in error toasts and the map), "AgriSense" elsewhere, the logo is lower-case "agrisense". → "AgriSense" in all text; the lower-case logo is fine as a style choice.

**Touch targets under 32 px (24 found)**: Skip link 32×16, EN 35×24, ಕನ್ನಡ 57×24, "See all" 40×20, Week select 48×16, 1× speed button 30×36, legend chips 24 px tall, capture-stepper arrows. → Hit area at least 40×40 (padding only, same look).

**Kannada gaps (hard-coded English, does not switch with ಕನ್ನಡ)**
- FarmerDashboard: "Nothing captured yet.", "sim", "Viewing historical capture" / "Latest capture", "back to latest", "Stale - no capture for…", "Detections:", "Readings:", "Recent Captures", "bugs", the battery banner, the simulated-data fallback, "Photo rejected".
- TrapCanvas: "pinned", "Confidence", "This capture has no image.", "Interactive Trap View".
- AdvisoryCard: "Rule engine", "No advisory", "What to do".
- WeatherCard: "Stale forecast", "Next whitefly generation", "Wind".
- WhatIfCard and ImpactCard labels.
- DailyTimeline / events.js: "Released biocontrol", "Not yet", "Advice →", "insects counted".
- ActionLogCard titles; "Close" aria-labels.
- Placeholders "Polyhouse 4" and "e.g. rows 1-4, neem oil".
- Backend English: economics lines, decision reasons, weather labels.

→ Add en+kn keys for all of these. Backend texts need a `lang` parameter or translation keys.

## P3: code hygiene (no visible change)

- **30 unused i18n keys** (plus their kn copies): `status.vision/trap/trapType/capture/never`, `glow.*` (12), `day.*` (6), `card.noSpeech`, `weather.rainOk/rainNo/windOk/windNo/daylightOk/daylightNo`. Left over from removed components; delete them.
- Duplicate `HEADLINES` constant in `FarmerDashboard.jsx:53` (already defined elsewhere).
- Bundle: the main chunk is **1.08 MB** (over Vite's 500 KB warning), and `mapbox-gl` is bundled **twice** (760 KB × 2). KeplerView is 7.4 MB but lazy-loaded (fine). → Lazy-load the Map page and Live Vision, and dedupe mapbox through `manualChunks`.
- Gemini TTS returns 429 when the free quota runs out. The browser-voice fallback works, but the console shows a red 429. Log it quietly.

## Checked and fine

- No unnamed buttons, unlabeled inputs, images without alt, or duplicate ids; exactly one h1.
- Dark theme: 0 contrast failures. Silver edges do not cover content.
- No horizontal scroll at 375–578 px; the forecast rail scrolls inside its card.
- Overlays (Live Vision, Customize, command palette, guide, voice and location pickers) open above the window and close on Esc.
- Live Pi controls: fan confirmed in under 5 s, stream at 1.5 fps, capture_now acknowledged.
- Phone Check page: copy is clear and has no spelling mistakes.

**No spelling mistakes in the English copy.** The issues are consistency, translation coverage and sizing.
