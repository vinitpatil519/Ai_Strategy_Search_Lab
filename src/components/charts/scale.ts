/** Minimal scale + path helpers. Charts here are hand-built SVG rather than a
 *  charting library: the lab needs regime shading, split markers and crosshairs
 *  that read consistently, and that is easier to control directly than to
 *  configure around. */

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert: (pixel: number) => number;
}

export function linear(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/** Extend a domain by a fraction on both sides so lines never touch the frame. */
export function pad(domain: [number, number], fraction = 0.06): [number, number] {
  const [lo, hi] = domain;
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * fraction, hi + span * fraction];
}

export function extent(values: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  return [lo, hi];
}

export function mergedExtent(series: ArrayLike<number>[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const [a, b] = extent(s);
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  return [lo, hi];
}

/** Ticks on human-friendly round numbers. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo];
  const span = hi - lo;
  const rawStep = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step =
    (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) * magnitude;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(10)));
  }
  return out;
}

/** Straight-segment path. Values that are not finite break the line. */
export function linePath(
  values: ArrayLike<number>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let d = "";
  let open = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      open = false;
      continue;
    }
    const px = x(i);
    const py = y(v);
    if (!open) {
      d += `M${px.toFixed(2)} ${py.toFixed(2)}`;
      open = true;
    } else {
      d += `L${px.toFixed(2)} ${py.toFixed(2)}`;
    }
  }
  return d;
}

/** Filled area between the series and a baseline value. */
export function areaPath(
  values: ArrayLike<number>,
  x: (index: number) => number,
  y: (value: number) => number,
  baseline: number,
): string {
  const points: string[] = [];
  let first = -1;
  let last = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (first < 0) first = i;
    last = i;
    points.push(`${x(i).toFixed(2)} ${y(v).toFixed(2)}`);
  }
  if (points.length === 0 || first < 0) return "";
  const y0 = y(baseline).toFixed(2);
  return `M${x(first).toFixed(2)} ${y0}L${points.join("L")}L${x(last).toFixed(2)} ${y0}Z`;
}

/** Index of the data point nearest a pixel position. */
export function nearestIndex(pixel: number, count: number, x0: number, x1: number): number {
  if (count <= 1) return 0;
  const t = (pixel - x0) / (x1 - x0 || 1);
  return Math.max(0, Math.min(count - 1, Math.round(t * (count - 1))));
}
