# Contributing to Agrisense AI

Thank you for helping! Agrisense AI is a free, open-source insect-monitoring system for
smallholder farmers: sticky-trap photos → insect counts → a clear SPRAY / RELEASE BIOCONTROL /
WAIT decision with advice in English and ಕನ್ನಡ. You don't need to be an expert to help.

## Who this is for

- **Developers**: backend (Node.js), dashboard (React), Raspberry Pi agent and simulator
  (Python), inference service (Python / YOLO).
- **Agronomists and entomologists**: check the decision thresholds (currently placeholders
  in `backend/config/pests.json`), pest classes and the wording of the advice.
- **Farmers and field testers**: hang a trap, use the app, and tell us what it advised and
  what really happened. Use the **Field report** issue template. No code needed.
- **Kannada speakers**: review the translations in `frontend/src/lib/i18n.jsx`. They are a
  first draft.

### Help we especially need

- **Kannada review** of the farmer-facing text by a native speaker.
- **Labelled trap images**: photos of yellow sticky traps with insects marked (whitefly,
  Macrolophus, Nesidiocoris and other species). These let us measure accuracy honestly.
- **Field reports** from real farms (region, crop, trap type, days hung, photos, what the app
  advised, what happened).

Look for issues labelled
[`good first issue`](https://github.com/SVG700/Agrisense/labels/good%20first%20issue) and
[`help wanted`](https://github.com/SVG700/Agrisense/labels/help%20wanted).

## Setting up

You need Node.js 20 or later and Python 3.9 or later. Full details, including every
environment variable, are in the [README](README.md). Everything runs in **demo mode**
without any keys.

**Backend** (http://localhost:4000)

```bash
cd backend
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run dev
```

**Frontend** (http://localhost:5173, proxies `/api` to :4000)

```bash
cd frontend
npm install
npm run dev
```

**Edge simulator** (sends mock trap captures to the backend)

```bash
cd edge-simulator
python -m venv .venv
.venv/Scripts/activate        # Windows; macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python simulator.py --once
```

**Inference service** (optional, for phone and Telegram photos; see
[inference-service/README.md](inference-service/README.md))

```powershell
cd inference-service
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0 torchvision==0.29.2
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env      # set INFERENCE_API_KEY to a long random string
```

Model weights are **not** in the repository. Their licences belong to their original
sources, and Ultralytics is AGPL-3.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Never commit a `.env` file or any real key. Only the `.env.example` files belong in git.

## Running the tests

These are the commands from the README. No test uses real keys or makes a paid call.

```bash
cd backend && npm test               # node:test, all providers mocked
cd backend && npm run check          # syntax check of every backend file
cd frontend && npm test              # Vitest + Testing Library (jsdom)
cd frontend && npm run build         # production build
cd edge-simulator && python -m unittest discover -s tests -v
```

Inference service (uses a fake model, so no weights or GPU are needed):

```powershell
cd inference-service
.venv\Scripts\python -m unittest -v test_service
```

GitHub Actions runs the same checks on every pull request.

## Workflow: branches and pull requests

1. **Open or pick an issue** first for anything bigger than a typo, so we can agree on the approach.
2. **Fork** the repository (or create a branch if you have write access) and branch from `main`:
   - `feat/<short-name>` for features
   - `fix/<short-name>` for bug fixes
   - `docs/<short-name>` for documentation
   - `chore/<short-name>` for maintenance
3. Keep each pull request **small and focused** on one change.
4. **Run the tests** above and add tests for new behaviour.
5. **Open a pull request to `main`** and fill in the template. The maintainer reviews and merges.

## The honesty rule

Every result Agrisense shows must say where it came from. **Never present a simulated,
mocked or estimated value as a real measurement.** The README and `DECISIONS.md` describe
the labels:

- Detections: `ok` (model), `simulated`, `failed`, `not_configured`, `skipped`.
- Advisories: `gemini/ok` / `claude/ok`, `rule-engine/not_configured`,
  `rule-engine/fallback`, `none/skipped`.
- Readings: `hardware`, `simulator`, `dashboard`. Battery: `manual` or `device`.
- Thresholds are **placeholders** until validated. Experimental models (like pest29) are
  labelled **experimental**. Estimates (impact, rupee values, forecasts) say they are estimates.

Real photos must never get made-up detections. If something fails, show the failure
(for example "CHECK TRAP") instead of inventing a number. Don't quote accuracy without a
labelled evaluation set.

## Safety-related changes need maintainer review

Farmers may act on this advice, so these changes always need explicit review and approval
from the maintainer before merging:

- spray / pesticide / biocontrol wording or decision logic (`backend/src/services/decision.js`,
  `backend/src/services/advisor.js`, `backend/config/pests.json`)
- LLM prompts and their safety rules (for example: no exact doses or brand names, always
  refer to the product label rate and pre-harvest interval)
- translations of advice text

Please say clearly in the pull request if your change touches any of these.

## Reporting bugs and security issues

- Bugs and ideas: open an issue with the matching template.
- **Security problems** (leaked keys, auth bypass, advice injection): **do not open a public
  issue.** Follow [SECURITY.md](SECURITY.md).

## Code of Conduct

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence of contributions

Agrisense AI is licensed under the [Apache License 2.0](LICENSE). By submitting a
contribution, you agree it is licensed under the same Apache-2.0 terms ("inbound =
outbound", as in section 5 of the licence). You also confirm you have the right to submit
it. For images and data, that means you took them yourself or have permission to share them.
