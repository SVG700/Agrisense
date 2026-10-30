"""
Simulator-mode data source. Everything produced here is MOCK data and is sent
with data_source='simulator' so the backend and dashboard label it as such.
"""

import math
import random
import time


def clamp(value, low, high):
    return max(low, min(high, value))


class Microclimate:
    """Random-walk weather model with a gentle day/night cycle (always within sensor range)."""

    def __init__(self, surge=False, seed=None):
        self.rng = random.Random(seed)
        self.temperature = self.rng.uniform(20, 26)
        self.humidity = self.rng.uniform(55, 70)
        self.surge = surge
        self.tick = 0

    def step(self):
        self.tick += 1
        cycle = math.sin(self.tick / 6)
        drift = 0.6 if self.surge else 0.0
        self.temperature = clamp(self.temperature + self.rng.gauss(0.1 * cycle + drift * 0.3, 0.7), 10, 38)
        self.humidity = clamp(self.humidity + self.rng.gauss(-0.6 * cycle + drift * 2, 2.5), 30, 98)
        return round(self.temperature, 1), round(self.humidity, 1)

    def pest_density(self):
        """0..1 - insects thrive at 22-30 °C and RH > 70 %."""
        temp_factor = clamp(1 - abs(self.temperature - 27) / 12, 0, 1)
        hum_factor = clamp((self.humidity - 45) / 50, 0, 1)
        base = 0.15 + 0.75 * temp_factor * hum_factor + (0.25 if self.surge else 0)
        return round(clamp(base + self.rng.uniform(-0.08, 0.08), 0.02, 1), 2)


def mock_trap_url(api_url, density):
    """Synthetic trap image rendered by the backend; its detections are labelled 'simulated'."""
    seed = "%x%03d" % (int(time.time() * 1000), random.randint(0, 999))
    return "%s/api/mock-trap/%s.svg?d=%s" % (api_url.rstrip("/"), seed, density)


class SimulatedBattery:
    def __init__(self):
        self.level = 100.0

    def read(self):
        self.level = max(0.0, self.level - random.uniform(0.3, 1.2))
        return int(self.level)
