"""
OpenCV pipeline for the Live Vision stream (runs on the Pi, ~1-2 frames/s).

    frame (BGR) -> resize -> HSV yellow-card mask -> largest card region
                -> low-saturation blobs on the card (insects are white / dark
                   spots on bright yellow) -> morphological clean-up
                -> contours -> size filter -> relative boxes

This is a fast, explainable preview of what the camera sees. Insect COUNTS and
the spray decision still come from the Roboflow model on the backend; the
stream's boxes are labelled "blob", never as a species.
"""
from typing import Dict, List

PIPELINE = [
    "Picamera2 frame (1296x972)",
    "HSV yellow-card mask",
    "Low-saturation blobs on the card",
    "Open / close (3x3)",
    "Contours -> blobs by size",
]

# Placeholder thresholds; tune on real cards under your lighting
YELLOW_LO = (15, 70, 90)
YELLOW_HI = (40, 255, 255)
BLOB_MAX_SAT = 90  # insects are far less saturated than the yellow card
MIN_AREA_FRAC = 0.00004  # of the frame: drops sensor noise
MAX_AREA_FRAC = 0.01  # drops shadows, fingers, the card edge


def process(frame, width: int = 960) -> Dict:
    """Returns {frame, stages: [(name, image)], boxes: [{x, y, width, height, label}], card_found}."""
    import cv2  # lazy: only the Pi agent needs OpenCV
    import numpy as np

    h, w = frame.shape[:2]
    scale = width / float(w)
    img = cv2.resize(frame, (width, int(h * scale)), interpolation=cv2.INTER_AREA) if w > width else frame
    H, W = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # 1. Yellow card: biggest yellow region, filled (so insects on it count as "inside")
    yellow = cv2.inRange(hsv, YELLOW_LO, YELLOW_HI)
    yellow = cv2.morphologyEx(yellow, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(yellow, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    card = np.zeros((H, W), np.uint8)
    card_found = False
    if contours:
        big = max(contours, key=cv2.contourArea)
        if cv2.contourArea(big) > 0.05 * H * W:
            cv2.drawContours(card, [big], -1, 255, thickness=cv2.FILLED)
            card_found = True
    if not card_found:
        card[:] = 255  # no card in view: look at the whole frame

    # 2. Insects: low saturation inside the card
    low_sat = cv2.inRange(hsv[:, :, 1], 0, BLOB_MAX_SAT)
    blobs = cv2.bitwise_and(low_sat, card)
    # 3. Clean up speckle, join broken wings
    k = np.ones((3, 3), np.uint8)
    blobs = cv2.morphologyEx(blobs, cv2.MORPH_OPEN, k)
    blobs = cv2.morphologyEx(blobs, cv2.MORPH_CLOSE, k)

    # 4. Contours -> boxes in the size band of an insect
    found, _ = cv2.findContours(blobs, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    lo, hi = MIN_AREA_FRAC * H * W, MAX_AREA_FRAC * H * W
    boxes: List[Dict] = []
    for c in found:
        a = cv2.contourArea(c)
        if lo <= a <= hi:
            x, y, bw, bh = cv2.boundingRect(c)
            boxes.append({"x": x / W, "y": y / H, "width": bw / W, "height": bh / H, "label": "blob"})

    # Stage images for the dashboard: the card mask tinted over the frame, and the blob mask
    tint = img.copy()
    tint[card == 0] = (tint[card == 0] * 0.25).astype(np.uint8)
    mask_view = cv2.addWeighted(img, 0.35, cv2.cvtColor(yellow, cv2.COLOR_GRAY2BGR), 0.65, 0)
    blob_view = cv2.cvtColor(blobs, cv2.COLOR_GRAY2BGR)
    return {
        "frame": img,
        "stages": [("Yellow-card mask", mask_view), ("Card only", tint), ("Insect blobs", blob_view)],
        "boxes": boxes[:300],
        "card_found": card_found,
        "size": (W, H),
    }


def jpeg_b64(img, quality: int = 70) -> str:
    import base64

    import cv2

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")
