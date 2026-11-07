"""
AgriSense inference service: a trained pest detector behind a small HTTP API.

Known models (PROFILES below), recognised by their exact class names:
    agropest12   AgroPest-12 YOLOv8s, 12 field-pest classes, 512 px (the intended model)
    pest29       YOLO11s, 29 farmland pest species, 640 px - EXPERIMENTAL: mAP@50 0.25 on its own
                 validation set, so every result is labelled experimental
ONNX weights (.onnx) are preferred for files from outside: loading them cannot execute code,
unlike .pt checkpoints (Python pickle).

The Node backend calls it through its existing "generic" vision provider
(backend/src/services/vision.js), so the request/response shape is that contract:

    POST /detect   {"image_base64": "...", "content_type": "image/jpeg"}
                -> {"detections": [{"label", "class_id", "confidence", "bbox": [x1, y1, x2, y2]}],
                    "image_width", "image_height", "model", "inference_ms"}
                   bbox is in pixels of the (EXIF-rotated) image.
    GET  /health   model name, classes, input size, device - never the weights path

The model is loaded once at startup and refuses to start unless its class names match a
known profile exactly (so the stock COCO yolov8s.pt can never be served by mistake). One inference runs at a time (Ultralytics models are not thread-safe);
a short queue absorbs bursts and anything beyond it gets 503 instead of piling up.

Settings (environment variables, all optional):
    MODEL_PATH          weights file (default: the first of DEFAULT_WEIGHTS found in weights/)
    MODEL_IMGSZ         inference size (default: the profile's training size, 512 or 640)
    MODEL_CONF          lowest confidence returned (default 0.25; the backend applies its own counting threshold)
    MODEL_IOU           NMS IoU (default 0.5)
    MODEL_MAX_DET       max boxes per image (default 300)
    MAX_IMAGE_MB        largest accepted image (default 10)
    MAX_QUEUE           requests allowed to wait for the model (default 8)
    INFERENCE_API_KEY   if set, callers must send "Authorization: Bearer <key>"
    ALLOW_ANY_MODEL     "true" only for smoke tests with another model - never in production

Run:  .venv/Scripts/python -m uvicorn service:app --host 127.0.0.1 --port 8800
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

log = logging.getLogger("agrisense.inference")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

ROOT = Path(__file__).resolve().parent


def load_env_file(path: Path) -> None:
    """KEY=value lines from inference-service/.env; real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(ROOT / ".env")
# Class order is fixed by the training labels (pest detection.in/data/data.yaml)
AGROPEST_CLASSES = [
    "Ants", "Bees", "Beetles", "Caterpillars", "Earthworms", "Earwigs",
    "Grasshoppers", "Moths", "Slugs", "Snails", "Wasps", "Weevils",
]
# 29-class YOLO11s (fine-tuned from an IP102 checkpoint on "pests-hf", 2026-11-04). Class order from its ONNX metadata.
PEST29_CLASSES = [
    "pests", "Agrotis", "Athetis lepigone", "Athetis lineosa", "Chilo suppressalis", "Cnaphalocrocis medinalis Guenee",
    "Creatonotus transiens", "Diaphania indica", "Endotricha consocia", "Euproctis sparsa", "Gryllidae", "Gryllotalpidae",
    "Helicoverpa armigera", "Holotrichia oblita Faldermann", "Loxostege sticticalis", "Mamestra brassicae",
    "Maruca testulalis Geyer", "Mythimna separata", "Naranga aenescens Moore", "Nilaparvata", "Paracymoriza taiwanalis",
    "Sesamia inferens", "Sirthenea flavipes", "Sogatella furcifera", "Spodoptera exigua", "Spoladea recurvalis",
    "Staurophora celsia", "Timandra Recompta", "Trichoptera",
]
# A model is only served when its class names match one of these exactly.
PROFILES = {
    "agropest12": {"name": "agropest12-yolov8s", "classes": AGROPEST_CLASSES, "imgsz": 512, "experimental": False, "note": None},
    "pest29": {"name": "pest29-yolo11s-experimental", "classes": PEST29_CLASSES, "imgsz": 640, "experimental": True,
               "note": "Experimental: mAP@50 0.25 / precision 0.24 / recall 0.24 on its own validation set"},
}
# Looked for in this order when MODEL_PATH is not set (the proper AgroPest-12 model wins when present)
DEFAULT_WEIGHTS = ["best_yolov8s_agropest12.pt", "best.pt", "pest29-yolo11s.onnx"]
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
Image.MAX_IMAGE_PIXELS = 40_000_000  # ~40 MP: refuse decompression bombs


def env_num(name: str, default: float, cast=float):
    raw = os.environ.get(name, "").strip()
    try:
        return cast(raw) if raw else default
    except ValueError:
        raise SystemExit(f"{name} must be a number (got {raw!r})")


SETTINGS = {
    "imgsz": env_num("MODEL_IMGSZ", 0, int),  # 0 = the profile's training size
    "conf": env_num("MODEL_CONF", 0.25),
    "iou": env_num("MODEL_IOU", 0.5),
    "max_det": env_num("MODEL_MAX_DET", 300, int),
    "max_bytes": int(env_num("MAX_IMAGE_MB", 10) * 1024 * 1024),
    "max_queue": env_num("MAX_QUEUE", 8, int),
}
API_KEY = os.environ.get("INFERENCE_API_KEY", "").strip()
ALLOW_ANY_MODEL = os.environ.get("ALLOW_ANY_MODEL", "").strip().lower() in ("1", "true", "yes")


def find_weights() -> Path:
    explicit = os.environ.get("MODEL_PATH", "").strip()
    candidates = [Path(explicit)] if explicit else [ROOT / "weights" / n for n in DEFAULT_WEIGHTS]
    for p in candidates:
        p = p if p.is_absolute() else ROOT / p
        if p.is_file():
            return p
    names = ", ".join(str(c) for c in candidates)
    raise SystemExit(f"No model weights found (looked for {names}). See inference-service/weights/README.md.")


def profile_of(names: list[str]) -> Optional[str]:
    return next((pid for pid, p in PROFILES.items() if p["classes"] == names), None)


class Detector:
    """The loaded model + a one-at-a-time gate. Swappable in tests."""

    def __init__(self, model, weights_name: str):
        self.model = model
        self.weights_name = weights_name
        self.names = [model.names[i] for i in sorted(model.names)]
        self.profile_id = profile_of(self.names)
        self.profile = PROFILES.get(self.profile_id)
        self.imgsz = SETTINGS["imgsz"] or (self.profile["imgsz"] if self.profile else 640)
        self.lock = asyncio.Lock()
        self.waiting = 0
        if weights_name.endswith(".onnx"):
            self.device = "cpu (onnxruntime)"
        else:
            try:
                self.device = str(next(model.model.parameters()).device)
            except (AttributeError, StopIteration, TypeError):
                self.device = "cpu"

    @classmethod
    def load(cls) -> "Detector":
        from ultralytics import YOLO  # heavy import, only in the real service

        path = find_weights()
        started = time.perf_counter()
        model = YOLO(str(path), task="detect")
        det = cls(model, path.name)
        if not det.profile:
            msg = f"{path.name} is not a known pest model: its {len(det.names)} classes start {det.names[:5]}"
            if not ALLOW_ANY_MODEL:
                raise SystemExit(msg + " - refusing to serve it. (ALLOW_ANY_MODEL=true is for smoke tests only.)")
            log.warning("%s - serving anyway because ALLOW_ANY_MODEL=true (SMOKE TEST ONLY)", msg)
        elif det.profile["experimental"]:
            log.warning("serving EXPERIMENTAL model %s: %s", det.profile["name"], det.profile["note"])
        # Warm-up so the first real request is not the slow one (ONNX sessions build on first use)
        det.predict(Image.new("RGB", (det.imgsz, det.imgsz), (90, 120, 60)))
        log.info("model %s loaded in %.1fs: %d classes, imgsz %d, device %s", path.name, time.perf_counter() - started,
                 len(det.names), det.imgsz, det.device)
        return det

    def predict(self, image: Image.Image) -> list[dict]:
        result = self.model.predict(source=image, imgsz=self.imgsz, conf=SETTINGS["conf"], iou=SETTINGS["iou"],
                                    max_det=SETTINGS["max_det"], verbose=False)[0]
        out = []
        for box in result.boxes:
            cls_id = int(box.cls[0])
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            out.append({
                "label": result.names.get(cls_id, f"class_{cls_id}"),
                "class_id": cls_id,
                "confidence": round(float(box.conf[0]), 4),
                "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            })
        return out

    def describe(self) -> dict:
        p = self.profile
        return {"name": p["name"] if p else f"UNVERIFIED:{self.weights_name}", "profile": self.profile_id,
                "experimental": bool(p and p["experimental"]) or not p, "note": p["note"] if p else "unknown model",
                "weights": self.weights_name, "classes": self.names, "imgsz": self.imgsz, "device": self.device,
                "verified_agropest12": self.profile_id == "agropest12"}


class DetectRequest(BaseModel):
    image_base64: Optional[str] = None
    content_type: Optional[str] = None
    image_url: Optional[str] = None


def decode_image(req: DetectRequest) -> Image.Image:
    if req.image_url and not req.image_base64:
        # Fetching arbitrary URLs from here would be an SSRF hole; the backend always has the bytes.
        raise HTTPException(400, detail={"code": "image_url_unsupported", "message": "Send image_base64 instead of image_url"})
    if not req.image_base64:
        raise HTTPException(400, detail={"code": "no_image", "message": "image_base64 is required"})
    if len(req.image_base64) > SETTINGS["max_bytes"] * 4 // 3 + 16:
        raise HTTPException(413, detail={"code": "image_too_large", "message": f"Image is larger than {SETTINGS['max_bytes'] // 1048576} MB"})
    try:
        data = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, detail={"code": "bad_base64", "message": "image_base64 is not valid base64"})
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, detail={"code": "image_unreadable", "message": "The file is not a readable JPEG, PNG or WebP image"})
    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(415, detail={"code": "unsupported_format", "message": f"{fmt} images are not supported (JPEG, PNG, WebP)"})
    # Phones store rotation in EXIF: rotate first so boxes match what the farmer sees
    return ImageOps.exif_transpose(img).convert("RGB")


def check_auth(authorization: Optional[str]):
    if not API_KEY:
        return
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given.encode(), API_KEY.encode()):
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Missing or wrong inference API key"})


def create_app(loader=Detector.load) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.detector = loader()
        yield

    app = FastAPI(title="AgriSense inference service", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        body = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"error": body})

    @app.get("/health")
    async def health(request: Request):
        det: Detector = request.app.state.detector
        return {"ok": True, "model": det.describe(), "busy": det.lock.locked(), "waiting": det.waiting}

    @app.post("/detect")
    async def detect(req: DetectRequest, request: Request, authorization: Optional[str] = Header(default=None)):
        check_auth(authorization)
        det: Detector = request.app.state.detector
        image = decode_image(req)
        if det.waiting >= SETTINGS["max_queue"]:
            raise HTTPException(503, detail={"code": "busy", "message": "The model is busy; try again in a moment"})
        det.waiting += 1
        try:
            async with det.lock:
                started = time.perf_counter()
                detections = await run_in_threadpool(det.predict, image)
                ms = round((time.perf_counter() - started) * 1000, 1)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - reported, never crashes the service
            log.exception("inference failed")
            raise HTTPException(500, detail={"code": "inference_failed", "message": type(exc).__name__})
        finally:
            det.waiting -= 1
        log.info("detect %dx%d -> %d boxes in %.0f ms", image.width, image.height, len(detections), ms)
        info = det.describe()
        return {"detections": detections, "image_width": image.width, "image_height": image.height,
                "model": info["name"], "experimental": info["experimental"], "inference_ms": ms}

    return app


app = create_app()
