/**
 * A small sRGB to Lab and CIEDE2000 for tests that only need to check data, not the engines. The
 * engines hold the real, cross-checked implementation (services/engines); this one exists so a
 * TypeScript test can ask "are these two catalogue colours visibly different" without a server.
 */
export type Lab3 = [number, number, number];

export function hexToLab(hex: string): Lab3 {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = lin as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Plain Lab distance (CIE76): enough to say two swatches are not the same colour. Not CIEDE2000. */
export function distance(a: Lab3, b: Lab3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
