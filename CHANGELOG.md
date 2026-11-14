# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Open-source setup under the **Apache License 2.0**:
  - `LICENSE`, `NOTICE`, `AUTHORS.md`, `THIRD_PARTY_NOTICES.md`
  - `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `CONTRIBUTING.md`, `SECURITY.md`
  - GitHub issue templates (bug report, feature request, field report) and a pull request template
  - GitHub Actions CI for the backend, frontend, edge simulator and inference service
  - `license` / `author` / `repository` fields in both `package.json` files
  - README badges plus Open source, Contributing and License sections
  - `docs/ROADMAP_ISSUES.md` with draft roadmap issues

### What exists today

A summary of the project as built for the Chip to Crop hackathon (October–November 2026),
from the git history:

- **Backend** (Node.js / Express 5): trap capture ingestion with device keys, idempotency and
  an offline-safe pipeline, Supabase or in-memory storage, and public read APIs.
- **Detection**: Roboflow sticky-trap model with SAHI tiling, a photo quality gate (blurry /
  dark / overexposed / glare → CHECK TRAP), and a labelled demo fallback.
- **Decision engine**: predator-aware SPRAY / RELEASE BIOCONTROL / WAIT / CHECK TRAP with
  count ranges and a BORDERLINE flag. The thresholds are placeholders awaiting ICAR-IIHR
  validation.
- **Advisory**: Gemini (or Claude) explains the decision and never overrides it. A rule-engine
  fallback is used otherwise. AI voice is via Gemini text-to-speech.
- **Dashboard** (React 19 / Vite / Tailwind):
  - farmer analytics, trap cards and Live Vision frames from the Pi
  - weather ("Can I spray now?", degree-days) and a 7-day outlook
  - what-if simulator, action log, impact estimate and rupee-value Economic Impact Engine
    (all labelled as estimates)
  - English / ಕನ್ನಡ toggle
  - battery-only admin portal
- **Pest Surveillance Map** (kepler.gl) with a seeded, clearly simulated whitefly outbreak.
- **Phone Check** page and **Telegram** bot: daily summaries, instant alerts (English +
  Kannada), and photo → count and advice.
- **Raspberry Pi** trap-box agent and edge simulator: camera and sensor captures, an SQLite
  offline queue, hardware controls, a systemd service.
- **Inference service** (FastAPI): AgroPest-12 YOLOv8s profile and an experimental pest29
  YOLO11s ONNX profile for phone photos. Weights are not included.
- Deployment config for Vercel (dashboard) with a strict Content-Security-Policy.

### Known limitations

See "Known limitations" in the [README](README.md): no measured detection accuracy yet, the
decision thresholds are placeholders, the Kannada text is a first draft, and several
integrations are tested only against mocks.

[Unreleased]: https://github.com/SVG700/Agrisense/commits/main
