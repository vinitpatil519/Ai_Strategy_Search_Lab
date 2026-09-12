import { runBacktest, type CostModel } from "./backtest";
import { MarketContext } from "./context";
import { FAMILIES } from "./families";
import { behaviouralSignature, combineFeatures, metricFeatures } from "./features";
import { crossover, genomeDistance, genomeName, mutate, randomGenome } from "./genome";
import { detectRegimes } from "./hmm";
import { autoKMeans, kmeans } from "./kmeans";
import { computeMetrics, drawdownSeries, maskedExposure, maskedSharpe } from "./metrics";
import { generateUniverse } from "./market";
import { mulberry32, type Rng } from "./rng";
import { clamp, finite, mean, stdev } from "./stats";
import { tsne } from "./tsne";
import type {
  ClusterInfo,
  EvaluatedStrategy,
  FamilyId,
  FoldResult,
  GenerationStat,
  Genome,
  Metrics,
  SearchConfig,
  SearchRun,
  Universe,
} from "./types";

export interface SearchProgress {
  phase: "data" | "regimes" | "search" | "evaluate" | "cluster" | "done";
  message: string;
  /** 0..1 across the whole pipeline. */
  progress: number;
  generation?: number;
  evaluated?: number;
  best?: number;
  stat?: GenerationStat;
}

export type ProgressFn = (p: SearchProgress) => void;
export type StopFn = () => boolean;
/** Awaited between generations so a worker can process a cancel message. */
export type YieldFn = () => Promise<void>;

/** How many bars are reserved for indicator warm-up before anything is scored. */
const WARMUP = 260;
/** Cap on survivors carried into the clustering stage. */
const MAX_SURVIVORS = 140;
/** Minimum structural distance between two survivors. */
const DEDUPE_DISTANCE = 0.05;
/** Points kept per exported equity curve. */
const CURVE_POINTS = 420;

export function defaultConfig(): SearchConfig {
  return {
    seed: 20260912,
    universeId: "synthetic",
    symbols: ["EQIX", "TECH", "GOLD", "CRUD", "BOND", "DGTL"],
    families: FAMILIES.map((f) => f.id),
    population: 180,
    generations: 12,
    eliteFraction: 0.18,
    mutationRate: 0.35,
    crossoverRate: 0.55,
    costBps: 2,
    slippageBps: 3,
    volTarget: 0.12,
    splitRatio: 0.62,
    walkForwardFolds: 5,
    regimeStates: 4,
    clusterCount: "auto",
    minTrades: 12,
    objective: "robust",
  };
}

export function buildUniverse(config: SearchConfig, custom?: Universe): Universe {
  if (custom) return custom;
  return generateUniverse(config.seed);
}

interface Scored {
  genome: Genome;
  fitness: number;
  isMetrics: Metrics;
}

/** Fitness on the in-sample window only. The out-of-sample window is never
 *  touched during the search, so leaderboard OOS numbers stay honest. */
function scoreGenome(
  ctx: MarketContext,
  genome: Genome,
  config: SearchConfig,
  cost: CostModel,
  isEnd: number,
): Scored {
  const bt = runBacktest(ctx, genome, cost);
  const isMetrics = computeMetrics({
    result: bt,
    start: WARMUP,
    end: isEnd,
    benchReturns: ctx.benchReturns,
    dates: ctx.dates,
  });

  let raw: number;
  switch (config.objective) {
    case "sharpe":
      raw = isMetrics.sharpe;
      break;
    case "calmar":
      raw = clamp(isMetrics.calmar, -5, 5);
      break;
    case "return":
      raw = isMetrics.cagr * 6;
      break;
    default: {
      // Robust: reward consistency across three in-sample thirds and punish
      // dispersion, which filters strategies that live off one lucky stretch.
      const span = isEnd - WARMUP;
      const third = Math.floor(span / 3);
      const parts: number[] = [];
      for (let i = 0; i < 3; i++) {
        const s = WARMUP + i * third;
        const e = i === 2 ? isEnd : s + third;
        parts.push(
          computeMetrics({
            result: bt,
            start: s,
            end: e,
            benchReturns: ctx.benchReturns,
            dates: ctx.dates,
          }).sharpe,
        );
      }
      raw = mean(parts) - 0.55 * stdev(parts, 1);
      break;
    }
  }

  let fitness = finite(raw, -5);

  // Activity gate: too few trades means the metric is noise, not edge.
  if (isMetrics.trades < config.minTrades) {
    fitness -= 1.5 + 0.25 * (config.minTrades - isMetrics.trades);
  }
  if (isMetrics.exposure < 0.02) fitness -= 3;
  // Drawdown and leverage brakes.
  if (isMetrics.maxDrawdown < -0.5) fitness -= (Math.abs(isMetrics.maxDrawdown) - 0.5) * 4;
  if (isMetrics.vol > 0.6) fitness -= (isMetrics.vol - 0.6) * 2;

  return { genome, fitness: clamp(finite(fitness, -9), -9, 9), isMetrics };
}

function tournamentSelect(rng: Rng, pool: Scored[], size = 3): Scored {
  let best = pool[Math.floor(rng() * pool.length)];
  for (let i = 1; i < size; i++) {
    const challenger = pool[Math.floor(rng() * pool.length)];
    if (challenger.fitness > best.fitness) best = challenger;
  }
  return best;
}

function diversityOf(rng: Rng, pool: Scored[]): number {
  if (pool.length < 4) return 0;
  let total = 0;
  const samples = Math.min(140, pool.length * 2);
  for (let i = 0; i < samples; i++) {
    const a = pool[Math.floor(rng() * pool.length)].genome;
    const b = pool[Math.floor(rng() * pool.length)].genome;
    total += genomeDistance(a, b);
  }
  return total / samples;
}

function downsample(values: ArrayLike<number>, target = CURVE_POINTS): number[] {
  const n = values.length;
  if (n <= target) return Array.from(values as ArrayLike<number>);
  const step = n / target;
  const out: number[] = [];
  for (let i = 0; i < target; i++) out.push(values[Math.min(n - 1, Math.floor(i * step))]);
  return out;
}

function downsampleDates(dates: string[], from: number, to: number, target = CURVE_POINTS): string[] {
  const n = to - from;
  if (n <= target) return dates.slice(from, to);
  const step = n / target;
  const out: string[] = [];
  for (let i = 0; i < target; i++) out.push(dates[from + Math.min(n - 1, Math.floor(i * step))]);
  return out;
}

/** Expanding walk-forward: every fold trains on all prior bars and is scored
 *  on the block that follows it. */
export function walkForwardFolds(
  ctx: MarketContext,
  genome: Genome,
  cost: CostModel,
  folds: number,
): FoldResult[] {
  const n = ctx.bars;
  const usable = n - WARMUP;
  const block = Math.floor(usable / (folds + 1));
  if (block < 60) return [];
  const bt = runBacktest(ctx, genome, cost);
  const out: FoldResult[] = [];
  for (let f = 0; f < folds; f++) {
    const trainStart = WARMUP;
    const trainEnd = WARMUP + block * (f + 1);
    const testEnd = f === folds - 1 ? n : trainEnd + block;
    const m = computeMetrics({
      result: bt,
      start: trainEnd,
      end: testEnd,
      benchReturns: ctx.benchReturns,
      dates: ctx.dates,
    });
    out.push({
      fold: f + 1,
      train: { label: `${ctx.dates[trainStart]} to ${ctx.dates[trainEnd - 1]}`, start: trainStart, end: trainEnd },
      test: { label: `${ctx.dates[trainEnd]} to ${ctx.dates[testEnd - 1]}`, start: trainEnd, end: testEnd },
      sharpe: m.sharpe,
      cagr: m.cagr,
      maxDrawdown: m.maxDrawdown,
    });
  }
  return out;
}

export async function runSearch(
  config: SearchConfig,
  onProgress: ProgressFn,
  shouldStop: StopFn = () => false,
  customUniverse?: Universe,
  onYield: YieldFn = async () => {},
): Promise<SearchRun> {
  const startedAt = Date.now();
  const cost: CostModel = { costBps: config.costBps, slippageBps: config.slippageBps };

  onProgress({ phase: "data", message: "Building price universe", progress: 0.01 });
  const universe = buildUniverse(config, customUniverse);
  const ctx = new MarketContext(universe);
  const n = ctx.bars;
  const isEnd = Math.max(WARMUP + 200, Math.floor(n * config.splitRatio));
  const symbols = config.symbols.filter((s) => universe.series.some((x) => x.symbol === s));
  const activeSymbols = symbols.length ? symbols : universe.series.map((s) => s.symbol);
  const families = config.families.length ? config.families : FAMILIES.map((f) => f.id);

  onProgress({ phase: "regimes", message: "Fitting regime model", progress: 0.05 });
  const regimes = detectRegimes(universe.benchmark, config.regimeStates, config.seed);

  // ---------------------------------------------------------------- search
  const rng = mulberry32(config.seed ^ 0x9e3779b9);
  const generations: GenerationStat[] = [];
  const hall = new Map<string, Scored>();
  let population: Genome[] = Array.from({ length: config.population }, () =>
    randomGenome(rng, families, activeSymbols, config.volTarget, 0),
  );
  let evaluated = 0;
  let bestEver = -Infinity;

  for (let gen = 0; gen < config.generations; gen++) {
    if (shouldStop()) break;
    const genStart = Date.now();
    const scored: Scored[] = [];
    for (const genome of population) {
      scored.push(scoreGenome(ctx, genome, config, cost, isEnd));
      evaluated++;
    }
    scored.sort((a, b) => b.fitness - a.fitness);

    for (const s of scored.slice(0, Math.max(20, Math.floor(config.population * 0.3)))) {
      hall.set(s.genome.id, s);
    }
    bestEver = Math.max(bestEver, scored[0]?.fitness ?? -Infinity);

    const fitnessValues = scored.map((s) => s.fitness);
    const stat: GenerationStat = {
      generation: gen + 1,
      best: fitnessValues[0] ?? 0,
      median: fitnessValues[Math.floor(fitnessValues.length / 2)] ?? 0,
      worst: fitnessValues[fitnessValues.length - 1] ?? 0,
      diversity: diversityOf(rng, scored),
      evaluated,
      elapsedMs: Date.now() - genStart,
    };
    generations.push(stat);
    onProgress({
      phase: "search",
      message: `Generation ${gen + 1} of ${config.generations}`,
      progress: 0.07 + 0.63 * ((gen + 1) / config.generations),
      generation: gen + 1,
      evaluated,
      best: stat.best,
      stat,
    });

    await onYield();
    if (gen === config.generations - 1) break;

    // ------------------------------------------------------------ breeding
    const eliteCount = Math.max(2, Math.floor(config.population * config.eliteFraction));
    const elites = scored.slice(0, eliteCount);
    const next: Genome[] = elites.map((e) => e.genome);
    const immigrants = Math.max(2, Math.floor(config.population * 0.08));

    while (next.length < config.population - immigrants) {
      if (rng() < config.crossoverRate) {
        const a = tournamentSelect(rng, scored);
        const b = tournamentSelect(rng, scored);
        const child = crossover(rng, a.genome, b.genome, gen + 1);
        next.push(rng() < 0.5 ? mutate(rng, child, config.mutationRate * 0.5, activeSymbols, gen + 1) : child);
      } else {
        const parent = tournamentSelect(rng, scored);
        next.push(mutate(rng, parent.genome, config.mutationRate, activeSymbols, gen + 1));
      }
    }
    // Fresh blood each generation keeps the population from collapsing onto one
    // parameter basin when an early winner dominates.
    while (next.length < config.population) {
      next.push(randomGenome(rng, families, activeSymbols, config.volTarget, gen + 1));
    }
    population = next;
  }

  // ------------------------------------------------------------- survivors
  onProgress({ phase: "evaluate", message: "Scoring survivors out of sample", progress: 0.72 });
  const ranked = Array.from(hall.values()).sort((a, b) => b.fitness - a.fitness);
  const survivorsRaw: Scored[] = [];
  for (const candidate of ranked) {
    if (survivorsRaw.length >= MAX_SURVIVORS) break;
    const tooClose = survivorsRaw.some(
      (s) => genomeDistance(s.genome, candidate.genome) < DEDUPE_DISTANCE,
    );
    if (!tooClose) survivorsRaw.push(candidate);
  }

  const evaluatedStrategies: EvaluatedStrategy[] = [];
  const featureRows: number[][] = [];

  for (let idx = 0; idx < survivorsRaw.length; idx++) {
    const s = survivorsRaw[idx];
    const bt = runBacktest(ctx, s.genome, cost);
    const oos = computeMetrics({
      result: bt,
      start: isEnd,
      end: n,
      benchReturns: ctx.benchReturns,
      dates: ctx.dates,
    });
    const folds = walkForwardFolds(ctx, s.genome, cost, config.walkForwardFolds);
    const foldSharpes = folds.map((f) => f.sharpe);
    const robustness =
      foldSharpes.length < 2
        ? 0
        : clamp(
            (mean(foldSharpes) - 0.5 * stdev(foldSharpes, 1)) /
              Math.max(0.35, Math.abs(mean(foldSharpes)) + 0.35),
            -1,
            1,
          );

    const regimeSharpe: number[] = [];
    const regimeExposure: number[] = [];
    for (let r = 0; r < regimes.states.length; r++) {
      regimeSharpe.push(maskedSharpe(bt.returns, regimes.path, r, WARMUP, n).sharpe);
      regimeExposure.push(maskedExposure(bt.position, regimes.path, r, WARMUP, n));
    }

    const metric = metricFeatures(oos, s.isMetrics, s.genome);
    const behaviour = behaviouralSignature(bt.returns, isEnd, n, 12);
    const row = combineFeatures(metric, behaviour);
    featureRows.push(row);

    evaluatedStrategies.push({
      genome: s.genome,
      fitness: s.fitness,
      inSample: s.isMetrics,
      outSample: oos,
      walkForward: folds,
      regimeSharpe,
      regimeExposure,
      robustness,
      equity: downsample(Array.from(bt.equity.subarray(isEnd, n)).map((v, i, arr) => v / (arr[0] || 1))),
      equityDates: downsampleDates(ctx.dates, isEnd, n),
      drawdown: downsample(drawdownSeries(bt.returns, isEnd, n)),
      features: metric,
      cluster: 0,
      embedding: [0, 0],
      rank: idx + 1,
    });

    if (idx % 12 === 0) {
      onProgress({
        phase: "evaluate",
        message: `Scoring survivors out of sample (${idx + 1}/${survivorsRaw.length})`,
        progress: 0.72 + 0.16 * (idx / Math.max(1, survivorsRaw.length)),
        evaluated,
      });
      await onYield();
    }
  }

  // -------------------------------------------------------------- clusters
  onProgress({ phase: "cluster", message: "Embedding and clustering survivors", progress: 0.9 });
  const clusters = assignClusters(evaluatedStrategies, featureRows, config);

  // Final ranking: out-of-sample Sharpe, with robustness as the tie-break.
  evaluatedStrategies.sort(
    (a, b) => b.outSample.sharpe + b.robustness * 0.25 - (a.outSample.sharpe + a.robustness * 0.25),
  );
  evaluatedStrategies.forEach((s, i) => {
    s.rank = i + 1;
  });

  const familyStats = families.map((family) => {
    const rows = evaluatedStrategies.filter((s) => s.genome.family === family);
    const sharpes = rows.map((r) => r.outSample.sharpe).sort((a, b) => a - b);
    return {
      family,
      count: rows.length,
      medianSharpe: sharpes.length ? sharpes[Math.floor(sharpes.length / 2)] : 0,
      bestSharpe: sharpes.length ? sharpes[sharpes.length - 1] : 0,
    };
  });

  onProgress({ phase: "done", message: "Run complete", progress: 1, evaluated });

  return {
    config: { ...config, symbols: activeSymbols, families },
    startedAt,
    finishedAt: Date.now(),
    evaluated,
    survivors: evaluatedStrategies,
    generations,
    regimes,
    clusters,
    benchmark: {
      dates: downsampleDates(ctx.dates, WARMUP, n),
      equity: downsample(
        Array.from(universe.benchmark.subarray(WARMUP, n)).map(
          (v) => v / universe.benchmark[WARMUP],
        ),
      ),
    },
    split: {
      isEnd,
      total: n,
      isLabel: `${ctx.dates[WARMUP]} to ${ctx.dates[isEnd - 1]}`,
      oosLabel: `${ctx.dates[isEnd]} to ${ctx.dates[n - 1]}`,
    },
    familyStats,
  };
}

function assignClusters(
  strategies: EvaluatedStrategy[],
  rows: number[][],
  config: SearchConfig,
): ClusterInfo[] {
  if (strategies.length < 4) {
    strategies.forEach((s, i) => {
      s.cluster = 0;
      s.embedding = [i * 4 - strategies.length * 2, 0];
    });
    return [];
  }

  const z = standardizeRows(rows);
  const km =
    config.clusterCount === "auto"
      ? autoKMeans(z, 2, Math.min(8, Math.max(2, Math.floor(strategies.length / 8))), config.seed)
      : kmeans(z, config.clusterCount, config.seed);
  const embedding = tsne(z, {
    perplexity: Math.max(5, Math.min(30, Math.floor(strategies.length / 4))),
    iterations: 480,
    seed: config.seed,
  });

  strategies.forEach((s, i) => {
    s.cluster = km.labels[i];
    s.embedding = embedding[i] ?? [0, 0];
  });

  const infos: ClusterInfo[] = [];
  for (let c = 0; c < km.k; c++) {
    const members = strategies.filter((s) => s.cluster === c);
    if (members.length === 0) continue;
    const familyMix: Record<string, number> = {};
    for (const m of members) {
      familyMix[m.genome.family] = (familyMix[m.genome.family] ?? 0) + 1;
    }
    const centroid = km.centroids[c];
    let medoid = members[0];
    let bestDist = Infinity;
    for (const m of members) {
      const i = strategies.indexOf(m);
      let d = 0;
      for (let k = 0; k < centroid.length; k++) d += (z[i][k] - centroid[k]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        medoid = m;
      }
    }
    infos.push({
      id: c,
      size: members.length,
      label: describeCluster(members),
      centroidMetrics: {
        sharpe: mean(members.map((m) => m.outSample.sharpe)),
        cagr: mean(members.map((m) => m.outSample.cagr)),
        maxDrawdown: mean(members.map((m) => m.outSample.maxDrawdown)),
        vol: mean(members.map((m) => m.outSample.vol)),
      },
      familyMix,
      medoidId: medoid.genome.id,
    });
  }
  return disambiguate(infos, strategies).sort(
    (a, b) => b.centroidMetrics.sharpe - a.centroidMetrics.sharpe,
  );
}

function standardizeRows(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const cols = rows[0].length;
  const mu = new Array<number>(cols).fill(0);
  const sd = new Array<number>(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (const row of rows) sum += row[c];
    mu[c] = sum / rows.length;
    let acc = 0;
    for (const row of rows) acc += (row[c] - mu[c]) ** 2;
    sd[c] = Math.sqrt(acc / Math.max(1, rows.length - 1)) || 1;
  }
  return rows.map((row) => row.map((v, c) => clamp((v - mu[c]) / sd[c], -6, 6)));
}

/**
 * Two clusters can legitimately share a family, tempo and risk band, which
 * leaves identical labels on the map. Where that happens, add the trait that
 * actually separates them: how tied to the benchmark they are, and whether the
 * group earned or lost money out of sample.
 */
function disambiguate(infos: ClusterInfo[], strategies: EvaluatedStrategy[]): ClusterInfo[] {
  const seen = new Map<string, number>();
  for (const info of infos) seen.set(info.label, (seen.get(info.label) ?? 0) + 1);
  return infos.map((info) => {
    if ((seen.get(info.label) ?? 0) < 2) return info;
    const members = strategies.filter((s) => s.cluster === info.id);
    const corr = Math.abs(mean(members.map((m) => m.outSample.benchCorr)));
    const link = corr > 0.45 ? "market-linked" : corr < 0.2 ? "market-neutral" : "partly linked";
    const edge = info.centroidMetrics.sharpe > 0.15 ? "positive edge" : info.centroidMetrics.sharpe < -0.15 ? "negative edge" : "flat";
    return { ...info, label: `${info.label} · ${link} · ${edge}` };
  });
}

/** Name a cluster after its dominant family and its risk character. */
function describeCluster(members: EvaluatedStrategy[]): string {
  const counts = new Map<FamilyId, number>();
  for (const m of members) counts.set(m.genome.family, (counts.get(m.genome.family) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const famLabel = FAMILIES.find((f) => f.id === dominant[0])?.label ?? "Mixed";
  const pure = dominant[1] / members.length > 0.7;
  const hold = mean(members.map((m) => m.outSample.avgHold));
  const dd = mean(members.map((m) => Math.abs(m.outSample.maxDrawdown)));
  const tempo = hold > 40 ? "slow" : hold > 12 ? "swing" : "fast";
  const risk = dd > 0.3 ? "high risk" : dd > 0.15 ? "moderate" : "contained";
  return `${pure ? famLabel : `${famLabel}-led mix`} · ${tempo} · ${risk}`;
}

/** Detailed single-strategy run for the inspector panel. */
export interface StrategyInspection {
  id: string;
  name: string;
  dates: string[];
  equity: number[];
  benchmark: number[];
  drawdown: number[];
  position: number[];
  price: number[];
  regimePath: number[];
  trades: {
    entry: string;
    exit: string;
    direction: number;
    returnPct: number;
    bars: number;
    reason: string;
  }[];
  full: Metrics;
  monthly: { month: string; ret: number }[];
}

export function inspectStrategy(
  config: SearchConfig,
  genome: Genome,
  customUniverse?: Universe,
): StrategyInspection {
  const universe = buildUniverse(config, customUniverse);
  const ctx = new MarketContext(universe);
  const cost: CostModel = { costBps: config.costBps, slippageBps: config.slippageBps };
  const bt = runBacktest(ctx, genome, cost);
  const n = ctx.bars;
  const regimes = detectRegimes(universe.benchmark, config.regimeStates, config.seed);
  const series = ctx.series(genome.symbol);

  const full = computeMetrics({
    result: bt,
    start: WARMUP,
    end: n,
    benchReturns: ctx.benchReturns,
    dates: ctx.dates,
  });

  const monthlyMap = new Map<string, number>();
  for (let i = WARMUP; i < n; i++) {
    const key = ctx.dates[i].slice(0, 7);
    monthlyMap.set(key, (monthlyMap.get(key) ?? 1) * (1 + bt.returns[i]));
  }

  const base = bt.equity[WARMUP] || 1;
  const benchBase = universe.benchmark[WARMUP] || 1;

  return {
    id: genome.id,
    name: genomeName(genome),
    dates: downsampleDates(ctx.dates, WARMUP, n, 700),
    equity: downsample(Array.from(bt.equity.subarray(WARMUP, n)).map((v) => v / base), 700),
    benchmark: downsample(
      Array.from(universe.benchmark.subarray(WARMUP, n)).map((v) => v / benchBase),
      700,
    ),
    drawdown: downsample(drawdownSeries(bt.returns, WARMUP, n), 700),
    position: downsample(Array.from(bt.position.subarray(WARMUP, n)), 700),
    price: downsample(
      Array.from(series.close.subarray(WARMUP, n)).map((v) => v / series.close[WARMUP]),
      700,
    ),
    regimePath: downsample(Array.from(regimes.path.subarray(WARMUP, n)), 700),
    trades: bt.trades.slice(-160).map((t) => ({
      entry: ctx.dates[t.entryIndex],
      exit: ctx.dates[t.exitIndex],
      direction: t.direction,
      returnPct: t.returnPct,
      bars: t.bars,
      reason: t.exitReason,
    })),
    full,
    monthly: [...monthlyMap.entries()].map(([month, growth]) => ({ month, ret: growth - 1 })),
  };
}

/** Re-score a hand-edited genome against the same split the run used. */
export interface ManualEvaluation {
  isMetrics: Metrics;
  oosMetrics: Metrics;
  folds: FoldResult[];
  equity: number[];
  dates: string[];
  drawdown: number[];
  rules: string[];
}

export function evaluateManual(
  config: SearchConfig,
  genome: Genome,
  customUniverse?: Universe,
): ManualEvaluation {
  const universe = buildUniverse(config, customUniverse);
  const ctx = new MarketContext(universe);
  const cost: CostModel = { costBps: config.costBps, slippageBps: config.slippageBps };
  const n = ctx.bars;
  const isEnd = Math.max(WARMUP + 200, Math.floor(n * config.splitRatio));
  const bt = runBacktest(ctx, genome, cost);
  const base = bt.equity[WARMUP] || 1;
  return {
    isMetrics: computeMetrics({
      result: bt,
      start: WARMUP,
      end: isEnd,
      benchReturns: ctx.benchReturns,
      dates: ctx.dates,
    }),
    oosMetrics: computeMetrics({
      result: bt,
      start: isEnd,
      end: n,
      benchReturns: ctx.benchReturns,
      dates: ctx.dates,
    }),
    folds: walkForwardFolds(ctx, genome, cost, config.walkForwardFolds),
    equity: downsample(Array.from(bt.equity.subarray(WARMUP, n)).map((v) => v / base), 520),
    dates: downsampleDates(ctx.dates, WARMUP, n, 520),
    drawdown: downsample(drawdownSeries(bt.returns, WARMUP, n), 520),
    rules: [],
  };
}

export { WARMUP };
