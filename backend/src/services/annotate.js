/**
 * Draws the detections onto the trap photo (JPEG data URL) so a farmer can
 * see exactly what was counted: pests in red, predators in green, beneficials (bees, earthworms) in blue.
 * The overlay is an SVG composited by sharp; labels come from the class config.
 */
import sharp from 'sharp';
import { BENEFICIAL_IDS, CLASSES, PREDATOR_IDS } from './pestConfig.js';

const MAX_WIDTH = 1280;
const SHORT = { whitefly: 'WF', macrolophus: 'MR', nesidiocoris: 'NC' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const labelOf = (id) => SHORT[id] ?? CLASSES.find((c) => c.id === id)?.label_en ?? id;

/**
 * @param {Buffer} buffer original image
 * @param {{label, confidence, x, y, width, height}[]} boxes normalized to the (EXIF-rotated) image
 * @param {{banner?: string}} [opts] optional text banner (e.g. demo-detector notice)
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export async function annotateImage(buffer, boxes, { banner } = {}) {
  const base = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await base.clone().metadata();
  const srcW = meta.autoOrient?.width ?? meta.width;
  const srcH = meta.autoOrient?.height ?? meta.height;
  const W = Math.min(MAX_WIDTH, srcW);
  const H = Math.round((srcH * W) / srcW);
  const stroke = Math.max(2, Math.round(W / 400));
  const font = Math.max(11, Math.round(W / 70));

  const shapes = boxes.map((b) => {
    const color = PREDATOR_IDS.has(b.label) ? '#22c55e' : BENEFICIAL_IDS.has(b.label) ? '#38bdf8' : '#ef4444';
    const x = b.x * W;
    const y = b.y * H;
    const text = `${labelOf(b.label)} ${Math.round(b.confidence * 100)}%`;
    return (
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(b.width * W).toFixed(1)}" height="${(b.height * H).toFixed(1)}" ` +
      `fill="none" stroke="${color}" stroke-width="${stroke}"/>` +
      `<text x="${x.toFixed(1)}" y="${Math.max(font, y - 3).toFixed(1)}" font-size="${font}" font-family="sans-serif" ` +
      `font-weight="700" fill="${color}" stroke="#000" stroke-width="0.6" paint-order="stroke">${esc(text)}</text>`
    );
  });
  if (banner) {
    shapes.push(
      `<rect x="0" y="0" width="${W}" height="${font * 2}" fill="#f59e0b" opacity="0.92"/>` +
        `<text x="${font / 2}" y="${font * 1.4}" font-size="${font}" font-family="sans-serif" font-weight="700" fill="#111">${esc(banner)}</text>`
    );
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes.join('')}</svg>`);
  const jpeg = await base.resize({ width: W }).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
