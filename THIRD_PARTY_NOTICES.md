# Third-party notices

Agrisense AI's own code is licensed under the [Apache License 2.0](LICENSE). It uses the
third-party packages, hosted services and models below, each under its own licence or
terms. This file lists the main direct dependencies, not every transitive package. Run
`npm ls` or `pip list` in each component for the full tree.

Package licences were read from each package's own metadata (`package.json` in
`node_modules`, Python `METADATA`, or the PyPI JSON API) on 2026-11-14 for the versions
shown. Check again when you upgrade.

## Important: the inference service and AGPL-3.0

`inference-service/` loads `.pt` model weights with
[Ultralytics](https://github.com/ultralytics/ultralytics) (`ultralytics` 8.4.202),
which is licensed under **AGPL-3.0**.

- The AGPL-3.0 applies to the Ultralytics component. If you **distribute** the inference
  service, or **run it as a network service** that other people use, you must comply with
  the AGPL-3.0 for that component. For example, you must offer the corresponding source
  code to its users. Ultralytics also sells an enterprise licence as an alternative.
- The rest of this repository (`backend/`, `frontend/`, `edge-simulator/`, `demo/`,
  `supabase/`, docs) is Apache-2.0 and does not import Ultralytics. The backend only calls
  the inference service over HTTP, and the service is optional: with `PHONE_VISION_URL`
  empty, the backend does not use it.
- The service imports Ultralytics only when it loads a `.pt` file. `.onnx` weights run
  through ONNX Runtime (MIT) instead. That doesn't change Ultralytics' licence or the
  licence of weights trained with it (see below).

This is a plain-language summary, not legal advice.

## Models

| Model | Where it runs | Included in this repo? | Licence |
|---|---|---|---|
| Roboflow sticky-trap model `yellow-sticky-traps-bwxut-ieond/1` (classes WF, MR, NC) | Roboflow's hosted API (`serverless.roboflow.com`), called by the backend | **No.** It is a third-party hosted model, called through the API with your own key | Roboflow's terms and the model owner's licence on Roboflow Universe |
| AgroPest-12 YOLOv8s (`best_yolov8s_agropest12.pt`) | `inference-service/` | **No.** Weights are git-ignored and not distributed | Set by the model's and dataset's original sources. YOLOv8 models trained with Ultralytics are subject to Ultralytics' AGPL-3.0 terms. You must check this before use |
| pest29 YOLO11s (`pest29-yolo11s.onnx`, experimental) | `inference-service/` | **No.** Weights are git-ignored and not distributed | Set by the model's and dataset's original sources. YOLO11 models trained with Ultralytics are subject to Ultralytics' AGPL-3.0 terms. You must check this before use |

## External services

These are online services the code can call. Each has its own terms of service, privacy
policy and pricing. You need your own account or keys where noted. None of them is part
of this repository.

| Service | Used for | Needs a key |
|---|---|---|
| [Google Gemini API](https://ai.google.dev/) | Advisory text and text-to-speech (default LLM) | Yes (`GEMINI_API_KEY`) |
| [Anthropic Claude API](https://www.anthropic.com/) | Alternative advisory LLM | Yes (`ANTHROPIC_API_KEY`) |
| [Roboflow](https://roboflow.com/) | Hosted sticky-trap detection model | Yes (`ROBOFLOW_API_KEY` / `YOLO_API_KEY`) |
| [Supabase](https://supabase.com/) | Database and private image storage (optional; in-memory store otherwise) | Yes |
| [Telegram Bot API](https://core.telegram.org/bots/api) | Alerts, daily summaries and the photo bot | Yes (`TELEGRAM_BOT_TOKEN`) |
| [Open-Meteo](https://open-meteo.com/) (forecast and geocoding APIs) | Weather, spray window, degree-days | No. Free non-commercial use. Data is CC BY 4.0 and must be attributed |
| [OpenStreetMap Nominatim](https://nominatim.org/) | Reverse geocoding (place names for coordinates) | No. Usage policy applies. Data is © OpenStreetMap contributors, ODbL |
| [CARTO basemaps](https://carto.com/basemaps) | Default dark map tiles on the Pest Surveillance Map | No. CARTO's terms. Map data is © OpenStreetMap contributors |
| [Mapbox](https://www.mapbox.com/) | Optional satellite basemap | Yes (`VITE_MAPBOX_TOKEN`, optional) |

## Backend (`backend/package.json`)

| Package | Version | Licence |
|---|---|---|
| `@anthropic-ai/sdk` | 1.3.0 | Apache-2.0 |
| `@google/genai` | 2.32.0 | Apache-2.0 |
| `@supabase/supabase-js` | 2.118.0 | MIT |
| `axios` | 1.21.0 | MIT |
| `cors` | 2.8.6 | MIT |
| `dotenv` | 18.0.9 | BSD-2-Clause |
| `express` | 5.3.0 | MIT |
| `sharp` | 0.35.5 | Apache-2.0 |
| `@img/sharp-*` (prebuilt libvips binaries pulled in by `sharp`) | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |

## Frontend (`frontend/package.json`)

| Package | Version | Licence |
|---|---|---|
| `react`, `react-dom` | 19.3.1 | MIT |
| `@kepler.gl/actions`, `@kepler.gl/components`, `@kepler.gl/reducers` | 3.3.0-alpha.18 | MIT |
| `@deck.gl/*` (via kepler.gl, pinned with `overrides`) | 9.3.11 | MIT |
| `@luma.gl/*` (via kepler.gl, pinned with `overrides`) | 9.3.6 | MIT |
| `maplibre-gl` | 4.7.1 | BSD-3-Clause |
| `framer-motion` | 14.8.0 | MIT |
| `lucide-react` | 1.64.0 | ISC |
| `react-redux` | 9.3.1 | MIT |
| `redux` | 5.0.1 | MIT |
| `recharts` | 3.10.1 | MIT |
| Dev only: `vite` 8.3.5, `vitest` 5.0.5, `@vitejs/plugin-react` 6.1.2, `tailwindcss` / `@tailwindcss/vite` 4.3.3, `jsdom` 30.1.3, `@testing-library/dom` 10.4.2, `@testing-library/react` 16.3.3 | | MIT |

## Edge simulator and Raspberry Pi agent (`edge-simulator/requirements*.txt`)

| Package | Version checked | Licence |
|---|---|---|
| `requests` | 2.34.2 | Apache-2.0 |
| `smbus2` (Pi only) | 0.6.1 | MIT |
| `RPi.bme280` (Pi only) | 0.2.4 | MIT |
| `adafruit-circuitpython-dht` (Pi only, optional) | 4.0.12 | MIT |
| `picamera2` (Pi only, installed from apt) | 0.3.39 | BSD-2-Clause |

## Inference service (`inference-service/requirements.txt`)

| Package | Version | Licence |
|---|---|---|
| **`ultralytics`** | 8.4.202 | **AGPL-3.0** (see above) |
| `torch` (CPU build) | 2.15.0 | BSD-style, multiple licences (Apache-2.0, BSD-2/3-Clause, MIT, Zlib, others; see package metadata) |
| `torchvision` (CPU build) | 0.29.2 | BSD |
| `fastapi` | 0.162.0 | MIT |
| `uvicorn` | 0.54.0 | BSD-3-Clause |
| `pydantic` | 2.14.2 | MIT |
| `pillow` | 13.0.0 | MIT-CMU |
| `numpy` | 2.5.4 | BSD-3-Clause (bundled parts: 0BSD, MIT, Zlib, CC0-1.0) |
| `opencv-python-headless` | 5.0.0.93 | Apache-2.0 |
| `onnxruntime` | 1.31.1 | MIT |
| `onnx` | 1.23.2 | Apache-2.0 |
| `httpx` (tests only) | 0.28.1 | BSD-3-Clause |
