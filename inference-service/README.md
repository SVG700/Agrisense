# AgriSense inference service: AgroPest-12 YOLOv8s

The trained 12-class field-pest detector (AgroPest-12: ants, bees, beetles, caterpillars,
earthworms, earwigs, grasshoppers, moths, slugs, snails, wasps, weevils), served over HTTP
for the AgriSense backend.

```
Phone Check page / Telegram photo bot
  -> backend POST /api/check  (quality gate, decision, advice - unchanged)
     -> vision "generic" provider  (PHONE_VISION_URL)
        -> this service POST /detect  (YOLOv8s, CPU, imgsz 512)
Raspberry Pi trap captures -> Roboflow sticky-trap model (unchanged)
```

Nothing is stored by this service. The backend keeps doing what it already did with the
result: draw the annotated photo, count at `PHONE_VISION_MIN_CONFIDENCE`, and decide.

## Models the service accepts

A model is served only if its class names exactly match a profile in `service.py`:

| Profile | Weights file | Classes | Input | Status |
|---|---|---|---|---|
| `agropest12` | `weights/best_yolov8s_agropest12.pt` or `best.pt` | 12 (Ants … Weevils) | 512 | intended model; weights not available yet |
| `pest29` | `weights/pest29-yolo11s.onnx` | 29 farmland pest species | 640 | **EXPERIMENTAL**: mAP@50 0.25 on its own validation set; every result is labelled experimental in the app |

Without `MODEL_PATH`, the first file found in that order is used, so the AgroPest-12 weights take over
automatically once they are copied in. Then set `PHONE_VISION_CLASS_GROUP` in `backend/.env` to match
(`agropest12` or `pest29`).

Prefer `.onnx` for weights received from outside: an ONNX file is data only, while a `.pt` checkpoint is
a Python pickle that can run code when loaded.

## API

`POST /detect` (the backend's existing *generic* vision contract)

```json
{ "image_base64": "<jpeg/png/webp>", "content_type": "image/jpeg" }
```

```json
{ "detections": [{ "label": "Weevils", "class_id": 11, "confidence": 0.91, "bbox": [x1, y1, x2, y2] }],
  "image_width": 1280, "image_height": 960, "model": "agropest12-yolov8s", "inference_ms": 92.4 }
```

`bbox` is in pixels of the EXIF-rotated image. Errors are `{"error": {"code", "message"}}` with
400 (bad input), 401 (key), 413 (too large), 415 (not an image / format), 503 (busy) or 500.

`GET /health` reports the model name, class list, input size and device (never file paths).

## Setup (Windows, CPU)

```powershell
cd inference-service
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0 torchvision==0.29.2
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env      # set INFERENCE_API_KEY to a long random string
```

Copy the trained checkpoint to `weights\best_yolov8s_agropest12.pt` (22 MB). The service refuses
to start with any other model: the stock COCO `yolov8s.pt` is rejected by its class names.

## Run

```powershell
.venv\Scripts\python -m uvicorn service:app --host 127.0.0.1 --port 8800
```

Then in `backend/.env`:

```
PHONE_VISION_URL=http://127.0.0.1:8800/detect
PHONE_VISION_API_KEY=<same value as INFERENCE_API_KEY>
```

and restart the backend. `GET /api/health` shows `services.phone_vision`. Leaving
`PHONE_VISION_URL` empty switches the integration off (phone photos use the trap model again).

## Tests

```powershell
.venv\Scripts\python -m unittest -v test_service
```

## Performance and deployment

- Weights load once at startup (about 2 s) plus a warm-up pass, so the first request is not slow.
- One inference at a time (Ultralytics models are not thread-safe); `MAX_QUEUE` requests may
  wait, more get 503 so the backend reports a clear failure instead of hanging.
- CPU inference: about 0.1 s per phone photo on this laptop. No GPU or CUDA is needed.
  Memory is about 600 MB with PyTorch loaded.
- Any machine that runs the backend can run this service next to it on `127.0.0.1`. To host it
  elsewhere, put it behind HTTPS and keep `INFERENCE_API_KEY` set; the key only ever lives in
  the two `.env` files, never in the frontend.
- It restarts independently of the backend. While it is down, phone checks show
  "vision failed / CHECK TRAP" (no counts are invented) and everything else keeps working.
