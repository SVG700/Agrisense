"""
Raspberry Pi 5 hardware drivers (camera + temperature/humidity sensor).

All hardware libraries are imported lazily so simulator mode works on any
computer. A failed sensor read returns None - readings are NEVER fabricated.

Supported:
  camera : Raspberry Pi camera modules via Picamera2 (libcamera)
           install on Pi OS Bookworm with:  sudo apt install -y python3-picamera2
  sensor : bme280  - I2C (default address 0x76) via `smbus2` + `RPi.bme280`
           dht22   - GPIO via `adafruit-circuitpython-dht` (+ Blinka)
           none    - no sensor attached; readings are sent as null

NOTE: these drivers have not been exercised on physical hardware in this
repository's test environment. Verify with `python simulator.py --mode hardware --probe`.
"""

import logging
import os
import time
from typing import Optional, Tuple

log = logging.getLogger("agrisense.hardware")

TEMP_RANGE = (-40.0, 85.0)
HUM_RANGE = (0.0, 100.0)


class HardwareUnavailable(RuntimeError):
    """Raised when a required hardware library or device is missing."""


# --------------------------------------------------------------------- camera
class PiCamera:
    def __init__(self, width: int = 1920, height: int = 1080, warmup_s: float = 2.0):
        try:
            from picamera2 import Picamera2  # type: ignore
        except ImportError as exc:
            raise HardwareUnavailable(
                "picamera2 is not installed (sudo apt install -y python3-picamera2; "
                "create the venv with --system-site-packages)"
            ) from exc
        try:
            self._cam = Picamera2()
            self._cam.configure(self._cam.create_still_configuration(main={"size": (width, height)}))
            self._cam.start()
        except Exception as exc:  # noqa: BLE001 - libcamera raises various errors when no camera is attached
            raise HardwareUnavailable("camera not detected: %s" % exc) from exc
        time.sleep(warmup_s)  # let auto-exposure / white balance settle

    def capture(self, path: str) -> str:
        """Writes a JPEG to `path` (format chosen from the extension)."""
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".part"
        self._cam.capture_file(tmp, format="jpeg")
        os.replace(tmp, path)  # atomic: the queue never sees a half-written file
        return path

    def close(self) -> None:
        try:
            self._cam.stop()
            self._cam.close()
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------- sensors
def _validate(temp, hum) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    errors = []
    if temp is None or not (TEMP_RANGE[0] <= temp <= TEMP_RANGE[1]):
        errors.append("temperature invalid (%r)" % (temp,))
        temp = None
    if hum is None or not (HUM_RANGE[0] <= hum <= HUM_RANGE[1]):
        errors.append("humidity invalid (%r)" % (hum,))
        hum = None
    return (
        None if temp is None else round(float(temp), 2),
        None if hum is None else round(float(hum), 2),
        "; ".join(errors) or None,
    )


class BME280Sensor:
    def __init__(self, bus: int = 1, address: int = 0x76):
        try:
            import smbus2  # type: ignore
            import bme280  # type: ignore  (pip package: RPi.bme280)
        except ImportError as exc:
            raise HardwareUnavailable("pip install smbus2 RPi.bme280 (and enable I2C via raspi-config)") from exc
        self._bme280 = bme280
        self._bus = smbus2.SMBus(bus)
        self._address = address
        try:
            self._params = bme280.load_calibration_params(self._bus, address)
        except OSError as exc:
            raise HardwareUnavailable("BME280 not found on I2C bus %d at 0x%02x" % (bus, address)) from exc

    def read(self):
        try:
            data = self._bme280.sample(self._bus, self._address, self._params)
            return _validate(data.temperature, data.humidity)
        except OSError as exc:
            return None, None, "BME280 read failed: %s" % exc


class DHT22Sensor:
    def __init__(self, pin: str = "D4", retries: int = 3):
        try:
            import board  # type: ignore
            import adafruit_dht  # type: ignore
        except ImportError as exc:
            raise HardwareUnavailable("pip install adafruit-circuitpython-dht (requires Blinka/libgpiod)") from exc
        try:
            self._dev = adafruit_dht.DHT22(getattr(board, pin))
        except AttributeError as exc:
            raise HardwareUnavailable("unknown GPIO pin %s" % pin) from exc
        self._retries = retries

    def read(self):
        last = "no reading"
        for _ in range(self._retries):
            try:
                return _validate(self._dev.temperature, self._dev.humidity)
            except RuntimeError as exc:  # DHT sensors routinely fail single reads
                last = str(exc)
                time.sleep(2.0)
        return None, None, "DHT22 read failed: %s" % last


class NoSensor:
    def read(self):
        return None, None, "no sensor configured"


def make_sensor(kind: str, dht_pin: str = "D4", i2c_bus: int = 1, bme_address: int = 0x76):
    kind = (kind or "none").lower()
    if kind == "bme280":
        return BME280Sensor(i2c_bus, bme_address)
    if kind == "dht22":
        return DHT22Sensor(dht_pin)
    if kind == "none":
        return NoSensor()
    raise HardwareUnavailable("unknown sensor type %r (use bme280, dht22 or none)" % kind)
