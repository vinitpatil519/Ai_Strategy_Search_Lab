/** Small numeric helpers shared by metrics, features and the models. */

export function mean(xs: ArrayLike<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function variance(xs: ArrayLike<number>, ddof = 1): number {
  const n = xs.length;
  if (n <= ddof) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    s += d * d;
  }
  return s / (n - ddof);
}

export function stdev(xs: ArrayLike<number>, ddof = 1): number {
  return Math.sqrt(variance(xs, ddof));
}

export function skewness(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const sd = stdev(xs, 1);
  if (sd === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += ((xs[i] - m) / sd) ** 3;
  return (n / ((n - 1) * (n - 2))) * s;
}

export function kurtosis(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 4) return 0;
  const m = mean(xs);
  const sd = stdev(xs, 1);
  if (sd === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += ((xs[i] - m) / sd) ** 4;
  return s / n - 3;
}

export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function finite(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

/** Column-wise z-score. Mutates nothing; returns a new matrix. */
export function standardize(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const cols = rows[0].length;
  const mu = new Array<number>(cols).fill(0);
  const sd = new Array<number>(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let r = 0; r < rows.length; r++) s += rows[r][c];
    mu[c] = s / rows.length;
    let v = 0;
    for (let r = 0; r < rows.length; r++) v += (rows[r][c] - mu[c]) ** 2;
    sd[c] = Math.sqrt(v / Math.max(1, rows.length - 1)) || 1;
  }
  return rows.map((row) => row.map((x, c) => clamp((x - mu[c]) / sd[c], -6, 6)));
}

export const TRADING_DAYS = 252;
