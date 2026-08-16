// Arial advance widths (per-mille of font size) for ASCII 32-126, matching
// Helvetica/Arial AFM metrics. Used to estimate SERP snippet pixel widths.
const ARIAL_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778,
  R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

const DEFAULT_WIDTH = 600; // per-mille fallback for non-ASCII glyphs

/** Estimated rendered width in px of `text` at the given Arial font size. */
export function measurePx(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) {
    units += ARIAL_WIDTHS[ch] ?? DEFAULT_WIDTH;
  }
  return Math.round((units / 1000) * fontSizePx);
}

export const TITLE_FONT_PX = 20; // Google desktop result title
export const DESC_FONT_PX = 14; // Google desktop snippet

export function titlePx(text: string): number {
  return measurePx(text, TITLE_FONT_PX);
}

export function descPx(text: string): number {
  return measurePx(text, DESC_FONT_PX);
}
