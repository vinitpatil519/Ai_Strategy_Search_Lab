/** Vectorized indicator kernels. Each returns a Float64Array aligned to the
 *  input series; leading warm-up slots hold NaN so downstream code can skip
 *  them explicitly instead of silently trading on partial windows. */

const NA = Number.NaN;

export function sma(src: Float64Array, window: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  if (window <= 0 || window > n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += src[i];
    if (i >= window) sum -= src[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

export function ema(src: Float64Array, window: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  if (window <= 0 || window > n) return out;
  const k = 2 / (window + 1);
  let seed = 0;
  for (let i = 0; i < window; i++) seed += src[i];
  let prev = seed / window;
  out[window - 1] = prev;
  for (let i = window; i < n; i++) {
    prev = src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rollingStdev(src: Float64Array, window: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  if (window <= 1 || window > n) return out;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += src[i];
    sumSq += src[i] * src[i];
    if (i >= window) {
      sum -= src[i - window];
      sumSq -= src[i - window] * src[i - window];
    }
    if (i >= window - 1) {
      const m = sum / window;
      const v = Math.max(0, sumSq / window - m * m) * (window / (window - 1));
      out[i] = Math.sqrt(v);
    }
  }
  return out;
}

export function rollingMax(src: Float64Array, window: number): Float64Array {
  return rollingExtreme(src, window, true);
}

export function rollingMin(src: Float64Array, window: number): Float64Array {
  return rollingExtreme(src, window, false);
}

/** Monotonic-deque extreme: O(n) regardless of window size. */
function rollingExtreme(src: Float64Array, window: number, wantMax: boolean): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  if (window <= 0 || window > n) return out;
  const deque: number[] = [];
  for (let i = 0; i < n; i++) {
    while (deque.length && deque[0] <= i - window) deque.shift();
    while (deque.length) {
      const last = src[deque[deque.length - 1]];
      if (wantMax ? last <= src[i] : last >= src[i]) deque.pop();
      else break;
    }
    deque.push(i);
    if (i >= window - 1) out[i] = src[deque[0]];
  }
  return out;
}

/** Percent change over `window` bars. */
export function roc(src: Float64Array, window: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  for (let i = window; i < n; i++) {
    const base = src[i - window];
    out[i] = base === 0 ? NA : src[i] / base - 1;
  }
  return out;
}

/** Wilder-smoothed RSI. */
export function rsi(close: Float64Array, window: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NA);
  if (window <= 0 || window >= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= window; i++) {
    const d = close[i] - close[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= window;
  loss /= window;
  out[window] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = window + 1; i < n; i++) {
    const d = close[i] - close[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (window - 1) + g) / window;
    loss = (loss * (window - 1) + l) / window;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Average true range, Wilder smoothing. */
export function atr(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  window: number,
): Float64Array {
  const n = close.length;
  const tr = new Float64Array(n).fill(NA);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    );
  }
  const out = new Float64Array(n).fill(NA);
  if (window <= 0 || window >= n) return out;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += tr[i];
  let prev = sum / window;
  out[window - 1] = prev;
  for (let i = window; i < n; i++) {
    prev = (prev * (window - 1) + tr[i]) / window;
    out[i] = prev;
  }
  return out;
}

/** Rolling z-score of a series against its own window. */
export function zscore(src: Float64Array, window: number): Float64Array {
  const m = sma(src, window);
  const s = rollingStdev(src, window);
  const out = new Float64Array(src.length).fill(NA);
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(m[i]) || Number.isNaN(s[i]) || s[i] === 0) continue;
    out[i] = (src[i] - m[i]) / s[i];
  }
  return out;
}

/** Annualized realized volatility from log returns. */
export function realizedVol(returns: Float64Array, window: number, periodsPerYear = 252): Float64Array {
  const sd = rollingStdev(returns, window);
  const out = new Float64Array(returns.length).fill(NA);
  const scale = Math.sqrt(periodsPerYear);
  for (let i = 0; i < sd.length; i++) out[i] = Number.isNaN(sd[i]) ? NA : sd[i] * scale;
  return out;
}

/** Rank of the current value inside a trailing window, in [0,1]. */
export function rollingPercentile(src: Float64Array, window: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  for (let i = window - 1; i < n; i++) {
    if (Number.isNaN(src[i])) continue;
    let below = 0;
    let counted = 0;
    for (let j = i - window + 1; j <= i; j++) {
      if (Number.isNaN(src[j])) continue;
      counted++;
      if (src[j] <= src[i]) below++;
    }
    out[i] = counted > 1 ? (below - 1) / (counted - 1) : NA;
  }
  return out;
}

/**
 * Rolling mean that tolerates NaN.
 *
 * `sma` keeps a running sum, so a single NaN in the input poisons every later
 * value. Indicators derived from other indicators (which carry NaN warm-up
 * slots) must be smoothed with this instead.
 */
export function smoothIgnoringNaN(src: Float64Array, window: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NA);
  if (window <= 1) return Float64Array.from(src);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      if (Number.isNaN(src[j])) continue;
      sum += src[j];
      count++;
    }
    // Require at least half the window to be real before emitting a value.
    if (count >= Math.max(1, Math.ceil(window / 2))) out[i] = sum / count;
  }
  return out;
}

/** Simple close-to-close log returns; first element is 0. */
export function logReturns(close: Float64Array): Float64Array {
  const out = new Float64Array(close.length);
  for (let i = 1; i < close.length; i++) out[i] = Math.log(close[i] / close[i - 1]);
  return out;
}

export function simpleReturns(close: Float64Array): Float64Array {
  const out = new Float64Array(close.length);
  for (let i = 1; i < close.length; i++) out[i] = close[i] / close[i - 1] - 1;
  return out;
}
