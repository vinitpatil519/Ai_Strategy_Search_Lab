/** Shared domain types for the search lab. */

export type FamilyId = "trend" | "breakout" | "meanReversion" | "carry" | "volatility";

export interface Series {
  symbol: string;
  label: string;
  assetClass: string;
  dates: string[];
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

export interface Universe {
  id: string;
  label: string;
  dates: string[];
  series: Series[];
  /** Equal-weight index of the universe, used as the benchmark + carry anchor. */
  benchmark: Float64Array;
}

export type Side = "long" | "short" | "both";

export interface RiskGenes {
  /** Annualized volatility target used for position sizing. */
  volTarget: number;
  maxLeverage: number;
  /** Stop distance in ATR multiples; 0 disables. */
  stopAtr: number;
  /** Profit target in ATR multiples; 0 disables. */
  takeAtr: number;
  /** Hard bar limit on a position; 0 disables. */
  maxHold: number;
  /** Bars that must pass before re-entry after an exit. */
  coolDown: number;
}

export interface Genome {
  id: string;
  family: FamilyId;
  symbol: string;
  side: Side;
  /** Family-specific parameter vector, keyed by the family's schema. */
  params: Record<string, number>;
  risk: RiskGenes;
  /** Provenance for the lineage view. */
  origin: "seed" | "mutation" | "crossover" | "manual";
  generation: number;
  parents?: string[];
}

export interface TradeRecord {
  entryIndex: number;
  exitIndex: number;
  direction: 1 | -1;
  returnPct: number;
  bars: number;
  exitReason: "signal" | "stop" | "target" | "timeout" | "end";
}

export interface BacktestResult {
  /** Per-bar strategy returns net of costs, aligned to universe dates. */
  returns: Float64Array;
  /** Signed position actually held on each bar (already lagged one bar). */
  position: Float64Array;
  equity: Float64Array;
  trades: TradeRecord[];
  turnover: number;
}

export interface Metrics {
  cagr: number;
  sharpe: number;
  sortino: number;
  vol: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  profitFactor: number;
  trades: number;
  avgHold: number;
  exposure: number;
  turnover: number;
  skew: number;
  kurtosis: number;
  ulcer: number;
  tailRatio: number;
  benchCorr: number;
  bestMonth: number;
  worstMonth: number;
}

export interface WindowSlice {
  label: string;
  start: number;
  end: number;
}

export interface FoldResult {
  fold: number;
  train: WindowSlice;
  test: WindowSlice;
  sharpe: number;
  cagr: number;
  maxDrawdown: number;
}

export interface EvaluatedStrategy {
  genome: Genome;
  fitness: number;
  inSample: Metrics;
  outSample: Metrics;
  walkForward: FoldResult[];
  /** Sharpe achieved inside each detected regime, indexed by regime id. */
  regimeSharpe: number[];
  regimeExposure: number[];
  robustness: number;
  /** Stitched out-of-sample equity curve, downsampled for transport. */
  equity: number[];
  equityDates: string[];
  drawdown: number[];
  features: number[];
  cluster: number;
  embedding: [number, number];
  rank: number;
}

export interface RegimeState {
  id: number;
  label: string;
  tone: "bull" | "bear" | "chop" | "stress" | "calm";
  share: number;
  meanReturn: number;
  vol: number;
  avgLength: number;
}

export interface RegimeTimeline {
  states: RegimeState[];
  /** Per-bar most-likely state (Viterbi path). */
  path: Int32Array;
  segments: { state: number; start: number; end: number }[];
  logLikelihood: number;
  iterations: number;
}

export interface ClusterInfo {
  id: number;
  size: number;
  label: string;
  centroidMetrics: { sharpe: number; cagr: number; maxDrawdown: number; vol: number };
  familyMix: Record<string, number>;
  medoidId: string;
}

export interface SearchConfig {
  seed: number;
  universeId: string;
  symbols: string[];
  families: FamilyId[];
  population: number;
  generations: number;
  eliteFraction: number;
  mutationRate: number;
  crossoverRate: number;
  costBps: number;
  slippageBps: number;
  volTarget: number;
  splitRatio: number;
  walkForwardFolds: number;
  regimeStates: number;
  clusterCount: number | "auto";
  minTrades: number;
  objective: "sharpe" | "calmar" | "robust" | "return";
}

export interface GenerationStat {
  generation: number;
  best: number;
  median: number;
  worst: number;
  diversity: number;
  evaluated: number;
  elapsedMs: number;
}

export interface SearchRun {
  config: SearchConfig;
  startedAt: number;
  finishedAt: number;
  evaluated: number;
  survivors: EvaluatedStrategy[];
  generations: GenerationStat[];
  regimes: RegimeTimeline;
  clusters: ClusterInfo[];
  benchmark: { dates: string[]; equity: number[] };
  split: { isEnd: number; total: number; isLabel: string; oosLabel: string };
  familyStats: { family: FamilyId; count: number; medianSharpe: number; bestSharpe: number }[];
}
