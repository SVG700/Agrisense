# Decisions

Architecture and engineering decisions, newest first. Each entry says what was
chosen, why, and what it costs.

---

## 2026-10-30 · Pest Surveillance Map (kepler.gl) — branch `feature/kepler-map`

### D1. kepler.gl `3.3.0-alpha.18`, not the stable `3.2.6`
- **Why:** stable 3.2.6 bundles React 18 as a direct dependency; this app is on
  React 19.3. Installing it would load two Reacts, which breaks hooks ("Invalid hook
  call"). Only the 3.3 line declares React 19. Chosen by the project owner.
- **Pinned exactly** (`--save-exact`) to alpha.18 (published 2026-10-19) rather than
  alpha.19 (2 days old at install time). Same for `@kepler.gl/reducers` and `@kepler.gl/actions`.
- **Cost:** pre-release software. Re-test the map before bumping, and move to the first
  stable 3.3.x when it ships.

### D2. Redux only for the map, inside a lazy chunk
- kepler.gl requires a Redux store with its reducer and `taskMiddleware`
  (`enhanceReduxMiddleware`). That store lives in `frontend/src/map/store.js` and
  is created inside `KeplerView`. The rest of the dashboard keeps plain React state.
- `App` lazy-loads `PestMapPage` (13 KB), which lazy-loads `KeplerView` (kepler.gl,
  deck.gl, MapLibre, Redux: about 7.4 MB, 2 MB gzipped) **only after** the basemap is
  reachable and WebGL works. The main dashboard bundle grew by about 12 KB.

### D3. One deck.gl / luma.gl version via npm `overrides`
- **Problem found in the browser:** kepler.gl resolved deck.gl 9.4.1 / luma.gl 9.4.2,
  but `@deck.gl-community/editable-layers` (kepler's drawing tool) pins `~9.3`, so npm
  installed 9.3.11 / 9.3.6 as well. Shaders from one generation compiled inside the
  other's renderer failed
  (`'DECKGL_FILTER_GL_POSITION' : no matching overloaded function`) and luma.gl covered
  the page with its shader-error viewer.
- **Fix:** `frontend/package.json` `overrides` force every `@deck.gl/*` to `9.3.11` and
  every `@luma.gl/*` to `9.3.6`. That satisfies both kepler (`^9.3.1`) and
  editable-layers (`~9.3`). Verified: a single version of each package, and no shader errors.

### D4. A browser shim for Node's `assert`
- `@kepler.gl/utils` does `import assert from 'assert'` and calls `assert('message')`
  as a warning. Vite stubs Node built-ins, so this crashed while loading data.
- `vite.config.js` aliases `assert` to `src/map/shims/assert.js`, which keeps Node's
  semantics: it throws only on a falsy value, so a message string is a no-op.
  No polyfill package was added. kepler's `fs`/`path` imports are only in a spec
  file, and `buffer` is only used for GeoJSON WKB, which this map doesn't use.

### D5. CSP additions for the map
Found by testing the **production build** with its CSP (`vite preview`):
- `worker-src 'self' blob:`: MapLibre and deck.gl run web workers from blob URLs.
- `script-src 'self' 'wasm-unsafe-eval'`: kepler.gl initialises a WebAssembly module
  (`parquet_wasm`) at start-up. `'wasm-unsafe-eval'` allows compiling WebAssembly
  but **not** JavaScript `eval()`; it's much narrower than `'unsafe-eval'`.
- Kept in sync in `vite.config.js` (preview) and `frontend/public/_headers` (static hosts).

### D6. Basemap: token-free by default; `VITE_MAPBOX_TOKEN` for satellite
- The default is CARTO "dark-matter" through MapLibre; no token is needed.
- The brief asked for `MAPBOX_TOKEN`, but Vite only exposes `VITE_*` variables to
  browser code (deliberately, to stop server secrets reaching the bundle), so the
  variable is **`VITE_MAPBOX_TOKEN`** in `frontend/.env`. When it's set, a "Satellite
  (Mapbox)" style is added. Mapbox browser tokens are public by design: use a
  URL-restricted `pk.` token.
- **Not verified live:** no Mapbox token was available. The style list is unit-tested.

### D7. Decision rule: one place, illustrative thresholds
- `backend/src/services/decision.js` is the single source:
  - `SPRAY`: `pest_count ≥ 40` and `predator_count / pest_count < 0.15`
  - `BIOCONTROL`: `pest_count ≥ 15` (including high counts with enough natural enemies)
  - `WAIT`: otherwise
- **These numbers are demo values, not validated economic thresholds** for any
  crop or pest. Calibrate them with an agronomist before real use.
- The seed script sends raw counts only; the server decides, so a client-sent
  `decision` is ignored (tested).
- Natural enemies in real detections are recognised by class name (ladybird,
  lacewing, hoverfly, parasitoid_wasp, encarsia, spider, predatory_mite). The current
  vision model doesn't output these classes, so real `predator_count` is 0 until it does.

### D8. Data model: daily observations + live aggregation
- **Schema v3** (`supabase/schema.sql`, idempotent and additive):
  - `devices.latitude/longitude/simulated`
  - a new `trap_daily_observations` table (unique per trap + day, RLS on)
- **`GET /api/map-data`** returns one row per trap per day:
  - seeded rows from `trap_daily_observations`
  - **real captures** rolled up per UTC day, using the highest per-capture count
    rather than a sum (the same sticky card is photographed repeatedly), for traps
    that have coordinates
  - real captures override seeded rows for the same trap and day
- **Unmigrated databases:** on a database without v3 the endpoint still returns real
  data, plus a warning to apply the schema.
- **Simulated traps** (`simulated=true`) are hidden from `GET /api/devices`, so they
  don't flood the main dashboard's trap picker.

### D9. Seeding through the API, never directly into the database
- `demo/seed.py` (Python standard library only) generates the data and `POST`s it to
  `POST /api/admin/map-seed`, which requires the admin key. That works the same against
  Supabase and the in-memory store, and keeps database credentials out of the script.
- The endpoint forces `simulated=true`, refuses to overwrite a real device (409), and
  upserts by trap + day, so re-seeding is idempotent. `DELETE /api/admin/map-seed`
  removes only simulated traps.
- Trap IDs are `uuid5` of the farm name (stable across runs); names start with `SIM ·`.
- **Generated data:** 18 traps on farm-level coordinates around Bengaluru Rural and
  Kolar. A whitefly front starts near Malur on day 1–2 and spreads at about
  4.8 km/day; natural enemies trail it by 3–4.5 days. Over 14 days the map goes from
  all-WAIT, through a growing SPRAY wave, to BIOCONTROL as the enemies catch up.

### D10. Time filter: noon timestamps, exactly-24-hour window
Found while verifying in the browser:
- **UTC parsing:** kepler parses `YYYY-MM-DD HH:mm:ss` as **UTC**, and when the config
  loads it clamps a filter window's start to the first data point. A
  midnight-to-midnight day window therefore became 12 hours wide during playback, so
  points blinked out for half of each day.
- **Fix:** rows are stamped at `12:00:00` UTC, and the initial window starts exactly at
  the first row and is exactly 24 hours long. Wherever it slides it contains one
  day's rows (unit-tested and checked by replaying in the browser).
- **Point sizes:** kepler scales point radii down at regional zoom, so
  `radiusRange [30, 120]` (about 8–30 px at zoom 9) keeps low-count WAIT traps visible.

### D11. Map failures never blank the page
- **WebGL check:** before loading kepler, the page checks WebGL and probes the
  basemap style URL (6 s timeout).
- **If either fails:** it shows a clear message and **does not download kepler at all**.
- **Runtime crashes:** an error boundary catches failures and shows "The map stopped working".
- **The trap table** (any day, with decision, counts and coordinates) is always shown,
  map or no map.

### D12. npm audit (reported, not fixable here)
`npm audit` after adding kepler.gl: **41 issues: 14 critical, 19 high, 7 moderate,
1 low**, all in kepler.gl's dependency tree (`main` had 0; the backend still has 0).
Most are propagation; the 9 underlying advisories:

| Package | Advisory | Exposure here / mitigation |
|---|---|---|
| `maplibre-gl` 4.7.1 | **Critical** XSS sanitizer bypass in `DOM.sanitize()` (GHSA-jrc7-96c5-q579), fixed in ≥6.4.1 | kepler requires `^4`. We never pass untrusted HTML to MapLibre popups; tooltips are kepler/React-rendered from our own data |
| `xlsx` 0.18.5 | Prototype pollution, ReDoS | Only via kepler's file-upload dialog, **hidden** (`readOnly` UI) |
| `thrift` 0.19.0 | Recursion, path traversal, response splitting | Parquet loader only; same mitigation |
| `d3-color` 2.0.0 | ReDoS on crafted colour strings | Colours come from our own config |
| `image-size` 0.7.5 | ICNS parser DoS | Texture tooling; unused at runtime |
| `postcss` 8.4.31 (nested) | Sourcemap file read / path traversal | Build-time only, nested; the app's own postcss is 8.5.32 |

No fix is available without kepler.gl updating its own dependencies. Re-run
`npm audit` whenever kepler.gl is bumped.

### D13. Git
The project had no repository. On 2026-10-30 it was initialised, with the existing code
as the first commit on `main` and this work on `feature/kepler-map`. `.env` files are
ignored, and `.gitattributes` forces LF line endings (the Pi's systemd unit and Python
need Unix line endings).
