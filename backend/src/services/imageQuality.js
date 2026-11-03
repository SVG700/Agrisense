/**
 * Is this sticky-trap photo good enough to count? Checks the four problems
 * that make field photos unreliable:
 *
 *   blurry   variance of the Laplacian (edge strength) is low
 *   dark     mean luminance is low
 *   bright   mean luminance is very high (overexposed / washed out)
 *   glare    a large share of near-white pixels (reflection on the shiny card)
 *
 * Measured on a copy resized to QUALITY_CONFIG.analysisWidth so the numbers
 * don't depend on the camera's resolution. Thresholds are placeholders in
 * backend/config/pests.json (image_quality) until tuned on real trap photos.
 * A photo that fails is not sent to the model and the trap shows CHECK TRAP.
 */
import sharp from 'sharp';
import { QUALITY_CONFIG } from './pestConfig.js';

/** Plain-language fixes, in the order a farmer should try them. */
const ADVICE = {
  blurry: 'Hold the phone steady about 30 cm from the card and tap to focus before taking the photo.',
  dark: 'Take the photo in daylight or turn on more light; avoid shadows over the card.',
  bright: 'Avoid direct sun on the card; shade it or step back so the photo is not washed out.',
  glare: 'Tilt the phone slightly so light does not reflect off the shiny card.',
};
const LABELS = { blurry: 'too blurry', dark: 'too dark', bright: 'overexposed', glare: 'glare on the card' };

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @param {Buffer} buffer JPEG/PNG/WebP photo
 * @returns {Promise<{ok: boolean, issues: string[], reason: string|null, advice: string[], metrics: object, thresholds: object}>}
 */
export async function assessQuality(buffer, cfg = QUALITY_CONFIG) {
  const { data, info } = await sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: cfg.analysisWidth, withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const n = w * h;

  // Luminance + glare in one pass
  const gray = new Float32Array(n);
  let sum = 0;
  let white = 0;
  for (let i = 0, p = 0; i < n; i++, p += c) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = y;
    sum += y;
    if (r >= cfg.glareLevel && g >= cfg.glareLevel && b >= cfg.glareLevel) white++;
  }
  const brightness = sum / n;
  const glare = white / n;

  // Sharpness: variance of the 4-neighbour Laplacian
  let lsum = 0;
  let lsq = 0;
  let m = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      lsum += lap;
      lsq += lap * lap;
      m++;
    }
  }
  // Edge strength scales with exposure, so normalise to mid-grey: a dim but sharp photo is not "blurry"
  const sharpness = m && brightness > 0 ? (lsq / m - (lsum / m) ** 2) * (128 / brightness) ** 2 : 0;

  const issues = [];
  if (brightness < cfg.minBrightness) issues.push('dark');
  else if (brightness > cfg.maxBrightness) issues.push('bright');
  else if (glare > cfg.maxGlareFraction) issues.push('glare');
  // A dark or washed-out photo has weak edges anyway: only call it blurry when exposure is fine
  if (!issues.includes('dark') && !issues.includes('bright') && sharpness < cfg.minSharpness) issues.push('blurry');

  return {
    ok: issues.length === 0,
    issues,
    reason: issues.length
      ? `The trap photo is ${issues.map((i) => LABELS[i]).join(' and ')}, so insects cannot be counted reliably. Retake it: ${issues
          .map((i) => ADVICE[i])
          .join(' ')}`
      : null,
    advice: issues.map((i) => ADVICE[i]),
    metrics: { sharpness: round(sharpness), brightness: round(brightness), glare_fraction: round(glare, 3), analysed: `${w}x${h}` },
    thresholds: {
      min_sharpness: cfg.minSharpness,
      min_brightness: cfg.minBrightness,
      max_brightness: cfg.maxBrightness,
      max_glare_fraction: cfg.maxGlareFraction,
      placeholder: true,
    },
  };
}
