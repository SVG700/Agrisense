/**
 * SAHI-style slicing for small insects on large sticky-trap photos.
 *
 * A whitefly is a few pixels wide on a 12 MP photo; resized to the model's
 * 640 px input it nearly disappears. Instead the photo is cut into an n x n
 * grid of overlapping tiles, each tile is detected at full resolution, the
 * boxes are mapped back to the whole image, and duplicates from the overlap
 * (the same insect seen in two tiles, often cut in half at a tile edge) are
 * removed.
 */

/**
 * @param {number} W image width (px)
 * @param {number} H image height (px)
 * @param {number} n tiles per side
 * @param {number} overlap fraction of a tile shared with its neighbour (0..0.5)
 * @returns {{left: number, top: number, width: number, height: number}[]} integer pixel rects covering the image
 */
export function tileGrid(W, H, n, overlap = 0.2) {
  if (n <= 1) return [{ left: 0, top: 0, width: W, height: H }];
  const axis = (len) => {
    const size = len / (n - (n - 1) * overlap);
    const step = size * (1 - overlap);
    return Array.from({ length: n }, (_, i) => {
      const start = Math.round(i * step);
      const end = i === n - 1 ? len : Math.min(len, Math.round(i * step + size));
      return [start, end - start];
    });
  };
  const xs = axis(W);
  const ys = axis(H);
  const tiles = [];
  for (const [top, height] of ys) for (const [left, width] of xs) tiles.push({ left, top, width, height });
  return tiles;
}

/** Tile-normalized box -> whole-image-normalized box. */
export function mapTileBox(box, tile, W, H) {
  const r = (v) => Math.round(v * 1e5) / 1e5;
  return {
    ...box,
    x: r((tile.left + box.x * tile.width) / W),
    y: r((tile.top + box.y * tile.height) / H),
    width: r((box.width * tile.width) / W),
    height: r((box.height * tile.height) / H),
  };
}

function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  return { iou: inter / (areaA + areaB - inter || 1), ios: inter / (Math.min(areaA, areaB) || 1) };
}

/**
 * Class-aware non-maximum suppression. A box is dropped when a kept box of the
 * same class overlaps it by IoU >= iou, or covers most of the smaller one
 * (intersection / smaller area >= ios) - the second rule catches insects cut
 * in half at a tile edge, whose partial box has a low IoU with the full one.
 */
export function dedupeBoxes(boxes, { iou = 0.5, ios = 0.7 } = {}) {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence || b.width * b.height - a.width * a.height);
  const kept = [];
  for (const b of sorted) {
    const dup = kept.some((k) => {
      if (k.label !== b.label) return false;
      const o = overlap(k, b);
      return o.iou >= iou || o.ios >= ios;
    });
    if (!dup) kept.push(b);
  }
  return kept;
}

/** Runs `fn` over items with at most `limit` in flight; preserves order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
