import {
  TRADING_DAYS,
  correlation,
  finite,
  kurtosis,
  mean,
  quantile,
  skewness,
  stdev,
} from "./stats";
import type { BacktestResult, Metrics } from "./types";

export interface MetricInput {
  result: BacktestResult;
  start: number;
  end: number;
  benchReturns: Float64Array;
  dates: string[];
}

const EMPTY: Metrics = {
  cagr: 0,
  sharpe: 0,
  sortino: 0,
  vol: 0,
  maxDrawdown: 0,
  calmar: 0,
  winRate: 0,
  profitFactor: 0,
  trades: 0,
  avgHold: 0,
  exposure: 0,
  turnover: 0,
  skew: 0,
  kurtosis: 0,
  ulcer: 0,
  tailRatio: 0,
  benchCorr: 0,
  bestMonth: 0,
  worstMonth: 0,
};

export function emptyMetrics(): Metrics {
  return { ...EMPTY };
}

export function computeMetrics({ result, start, end, benchReturns, dates }: MetricInput): Metrics {
  const n = end - start;
  if (n < 20) return emptyMetrics();

  const r = result.returns.subarray(start, end);
  const pos = result.position.subarray(start, end);
  const bench = benchReturns.subarray(start, end);

  const mu = mean(r);
  const sd = stdev(r, 1);
  const vol = sd * Math.sqrt(TRADING_DAYS);
  const sharpe = sd === 0 ? 0 : (mu / sd) * Math.sqrt(TRADING_DAYS);

  let downSq = 0;
  let downCount = 0;
  for (let i = 0; i < r.length; i++) {
    if (r[i] < 0) {
      downSq += r[i] * r[i];
      downCount++;
    }
  }
  const downside = downCount > 1 ? Math.sqrt(downSq / downCount) : 0;
  const sortino = downside === 0 ? 0 : (mu / downside) * Math.sqrt(TRADING_DAYS);

  // Equity, drawdown, ulcer index.
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let ddSq = 0;
  for (let i = 0; i < r.length; i++) {
    equity *= 1 + r[i];
    if (equity > peak) peak = equity;
    const dd = peak === 0 ? 0 : equity / peak - 1;
    if (dd < maxDd) maxDd = dd;
    ddSq += dd * dd;
  }
  const years = n / TRADING_DAYS;
  const cagr = equity <= 0 ? -1 : Math.pow(equity, 1 / Math.max(years, 1e-6)) - 1;
  const ulcer = Math.sqrt(ddSq / r.length);

  // Trade statistics restricted to trades that closed inside the window.
  const trades = result.trades.filter((t) => t.exitIndex >= start && t.exitIndex < end);
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let barsSum = 0;
  for (const t of trades) {
    if (t.returnPct > 0) {
      wins++;
      grossWin += t.returnPct;
    } else {
      grossLoss -= t.returnPct;
    }
    barsSum += t.bars;
  }

  let exposedBars = 0;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] !== 0) exposedBars++;
  }

  let turnoverWindow = 0;
  for (let i = start + 1; i < end; i++) {
    turnoverWindow += Math.abs(result.position[i] - result.position[i - 1]);
  }

  const sorted = Array.from(r).sort((a, b) => a - b);
  const p95 = quantile(sorted, 0.95);
  const p05 = quantile(sorted, 0.05);

  return {
    cagr: finite(cagr),
    sharpe: finite(sharpe),
    sortino: finite(sortino),
    vol: finite(vol),
    maxDrawdown: finite(maxDd),
    calmar: maxDd === 0 ? 0 : finite(cagr / Math.abs(maxDd)),
    winRate: trades.length ? wins / trades.length : 0,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? 4 : 0) : finite(grossWin / grossLoss),
    trades: trades.length,
    avgHold: trades.length ? barsSum / trades.length : 0,
    exposure: exposedBars / pos.length,
    turnover: finite((turnoverWindow / years) || 0),
    skew: finite(skewness(r)),
    kurtosis: finite(kurtosis(r)),
    ulcer: finite(ulcer),
    tailRatio: p05 === 0 ? 0 : finite(Math.abs(p95 / p05)),
    benchCorr: finite(correlation(r, bench)),
    ...monthlyExtremes(r, dates, start),
  };
}

function monthlyExtremes(
  r: Float64Array,
  dates: string[],
  start: number,
): { bestMonth: number; worstMonth: number } {
  const byMonth = new Map<string, number>();
  for (let i = 0; i < r.length; i++) {
    const key = (dates[start + i] ?? "").slice(0, 7);
    const prev = byMonth.get(key) ?? 1;
    byMonth.set(key, prev * (1 + r[i]));
  }
  let best = 0;
  let worst = 0;
  for (const growth of byMonth.values()) {
    const m = growth - 1;
    if (m > best) best = m;
    if (m < worst) worst = m;
  }
  return { bestMonth: finite(best), worstMonth: finite(worst) };
}

/** Drawdown series in percent (negative values) for a return slice. */
export function drawdownSeries(returns: Float64Array, start: number, end: number): number[] {
  const out: number[] = [];
  let equity = 1;
  let peak = 1;
  for (let i = start; i < end; i++) {
    equity *= 1 + returns[i];
    if (equity > peak) peak = equity;
    out.push(peak === 0 ? 0 : equity / peak - 1);
  }
  return out;
}

/** Sharpe of a return slice restricted to bars flagged by a mask. */
export function maskedSharpe(
  returns: Float64Array,
  mask: Int32Array,
  wanted: number,
  start: number,
  end: number,
): { sharpe: number; share: number } {
  const picked: number[] = [];
  for (let i = start; i < end; i++) if (mask[i] === wanted) picked.push(returns[i]);
  if (picked.length < 15) return { sharpe: 0, share: picked.length / Math.max(1, end - start) };
  const sd = stdev(picked, 1);
  const sharpe = sd === 0 ? 0 : (mean(picked) / sd) * Math.sqrt(TRADING_DAYS);
  return { sharpe: finite(sharpe), share: picked.length / (end - start) };
}

/** Fraction of masked bars on which the strategy actually held exposure. */
export function maskedExposure(
  position: Float64Array,
  mask: Int32Array,
  wanted: number,
  start: number,
  end: number,
): number {
  let total = 0;
  let held = 0;
  for (let i = start; i < end; i++) {
    if (mask[i] !== wanted) continue;
    total++;
    if (position[i] !== 0) held++;
  }
  return total === 0 ? 0 : held / total;
}
