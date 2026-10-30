/**
 * Deterministic synthetic sticky-trap generator.
 *
 * The same (seed, density) pair always yields the same insects, which lets us:
 *   1. render a believable trap photo as SVG (GET /api/mock-trap/:seed.svg), and
 *   2. have the simulated YOLO return bounding boxes that line up exactly with it.
 */

export const TRAP_WIDTH = 800;
export const TRAP_HEIGHT = 600;

/** Species the simulated model can detect, with drawing hints. */
export const SPECIES = {
  aphid: { color: '#4d7c0f', rx: 7, ry: 5, weight: 0.45 },
  whitefly: { color: '#f8fafc', rx: 8, ry: 6, weight: 0.3 },
  thrips: { color: '#78350f', rx: 10, ry: 3, weight: 0.15 },
  fungus_gnat: { color: '#1c1917', rx: 6, ry: 4, weight: 0.1 },
};

/** Small, fast seeded PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turns any string into a 32-bit seed. */
export function hashSeed(input) {
  let h = 2166136261;
  for (const ch of String(input)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickSpecies(rand) {
  let r = rand();
  for (const [name, s] of Object.entries(SPECIES)) {
    if ((r -= s.weight) <= 0) return name;
  }
  return 'aphid';
}

/**
 * @param {string} seed      any string
 * @param {number} density   0..1 - scales how many insects are stuck to the trap
 * @returns {{label, confidence, x, y, width, height, cx, cy, angle}[]} boxes normalized to 0..1
 */
export function generateTrap(seed, density = 0.4) {
  const rand = mulberry32(hashSeed(seed));
  const d = Math.min(1, Math.max(0, Number(density) || 0));
  const count = Math.round(4 + d * 56 + rand() * 6);
  const insects = [];

  for (let i = 0; i < count; i++) {
    const label = pickSpecies(rand);
    const { rx, ry } = SPECIES[label];
    const scale = 0.8 + rand() * 0.6;
    const cx = 40 + rand() * (TRAP_WIDTH - 80);
    const cy = 40 + rand() * (TRAP_HEIGHT - 80);
    const angle = Math.round(rand() * 360);
    // Padded square box around the rotated ellipse
    const half = Math.max(rx, ry) * scale + 4;

    insects.push({
      label,
      confidence: Number((0.62 + rand() * 0.37).toFixed(2)),
      x: (cx - half) / TRAP_WIDTH,
      y: (cy - half) / TRAP_HEIGHT,
      width: (half * 2) / TRAP_WIDTH,
      height: (half * 2) / TRAP_HEIGHT,
      cx,
      cy,
      angle,
      scale,
    });
  }
  return insects;
}

/** Renders the trap as an SVG string (yellow sticky card with grid + insects). */
export function renderTrapSvg(seed, density) {
  const insects = generateTrap(seed, density);
  const grid = [];
  for (let x = 50; x < TRAP_WIDTH; x += 50) {
    grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${TRAP_HEIGHT}" />`);
  }
  for (let y = 50; y < TRAP_HEIGHT; y += 50) {
    grid.push(`<line x1="0" y1="${y}" x2="${TRAP_WIDTH}" y2="${y}" />`);
  }

  const bugs = insects
    .map(({ label, cx, cy, angle, scale }) => {
      const { color, rx, ry } = SPECIES[label];
      const wings =
        label === 'whitefly'
          ? `<ellipse cx="-4" cy="0" rx="${rx * 0.9}" ry="${ry * 1.3}" fill="#ffffff" opacity="0.85"/>`
          : '';
      return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${angle}) scale(${scale.toFixed(2)})">${wings}<ellipse rx="${rx}" ry="${ry}" fill="${color}" stroke="#00000055" stroke-width="1"/></g>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TRAP_WIDTH}" height="${TRAP_HEIGHT}" viewBox="0 0 ${TRAP_WIDTH} ${TRAP_HEIGHT}">
  <defs>
    <radialGradient id="g" cx="50%" cy="45%" r="75%">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#eab308"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <g stroke="#a16207" stroke-opacity="0.35" stroke-width="1">${grid.join('')}</g>
  ${bugs}
</svg>`;
}

/**
 * Detects our own mock-trap URLs: /api/mock-trap/<seed>.svg?d=<density>
 * @returns {{seed: string, density: number} | null}
 */
export function parseMockTrapUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/mock-trap\/([\w.-]+)\.svg$/);
    if (!m) return null;
    return { seed: m[1], density: Number(u.searchParams.get('d') ?? 0.4) };
  } catch {
    return null;
  }
}
