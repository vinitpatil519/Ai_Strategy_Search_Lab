import { clamp } from "./stats";
import type { Genome, Metrics } from "./types";

/** Column names for the feature matrix fed to t-SNE and k-means. */
export const FEATURE_LABELS = [
  "Sharpe",
  "Sortino",
  "CAGR",
  "Volatility",
  "Max drawdown",
  "Ulcer",
  "Win rate",
  "Profit factor",
  "Avg hold",
  "Exposure",
  "Turnover",
  "Return skew",
  "Tail ratio",
  "Benchmark corr",
  "IS/OOS decay",
  "Trade count",
];

/**
 * Strategy fingerprint.
 *
 * Two blocks are concatenated: a risk/return block from the out-of-sample
 * metrics, and a behavioural block of coarse period returns. The metric block
 * groups strategies that *perform* alike; the behavioural block groups those
 * that are actually *doing the same thing* at the same time, which is what
 * makes the cluster map useful for picking uncorrelated survivors.
 */
export function metricFeatures(
  oos: Metrics,
  is: Metrics,
  _genome: Genome,
): number[] {
  const decay = is.sharpe === 0 ? 0 : clamp((is.sharpe - oos.sharpe) / Math.abs(is.sharpe), -3, 3);
  return [
    clamp(oos.sharpe, -4, 4),
    clamp(oos.sortino, -6, 6),
    clamp(oos.cagr, -1, 2),
    clamp(oos.vol, 0, 1.2),
    clamp(oos.maxDrawdown, -1, 0),
    clamp(oos.ulcer, 0, 1),
    clamp(oos.winRate, 0, 1),
    clamp(Math.log1p(Math.max(0, oos.profitFactor)), 0, 3),
    clamp(Math.log1p(oos.avgHold), 0, 6),
    clamp(oos.exposure, 0, 1),
    clamp(Math.log1p(oos.turnover), 0, 8),
    clamp(oos.skew, -3, 3),
    clamp(oos.tailRatio, 0, 4),
    clamp(oos.benchCorr, -1, 1),
    decay,
    clamp(Math.log1p(oos.trades), 0, 8),
  ];
}

/**
 * Coarse behavioural signature: the strategy's compounded return over each of
 * `buckets` equal slices of the evaluation window, scaled to a comparable
 * range. Captures *when* a strategy makes money, not just how much.
 */
export function behaviouralSignature(
  returns: Float64Array,
  start: number,
  end: number,
  buckets = 12,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  const span = end - start;
  if (span <= buckets) return out;
  const size = Math.floor(span / buckets);
  for (let b = 0; b < buckets; b++) {
    const from = start + b * size;
    const to = b === buckets - 1 ? end : from + size;
    let growth = 1;
    for (let i = from; i < to; i++) growth *= 1 + returns[i];
    out[b] = clamp(growth - 1, -1, 2);
  }
  return out;
}

/** Weight applied to the behavioural block before clustering, so 12 bucket
 *  columns do not drown out the 16 metric columns. */
export const BEHAVIOUR_WEIGHT = 0.6;

export function combineFeatures(metric: number[], behaviour: number[]): number[] {
  return [...metric, ...behaviour.map((v) => v * BEHAVIOUR_WEIGHT)];
}
