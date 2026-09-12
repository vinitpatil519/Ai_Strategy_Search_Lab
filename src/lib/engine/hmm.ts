import { kmeans } from "./kmeans";
import { mean, stdev } from "./stats";
import type { RegimeState, RegimeTimeline } from "./types";

/**
 * Gaussian hidden Markov model with diagonal covariance, fitted by
 * Baum-Welch (expectation maximization) and decoded with Viterbi.
 *
 * Observations are per-bar market descriptors (signed return, absolute return,
 * trend slope, volatility level). Scaled forward-backward keeps the recursions
 * numerically stable over thousands of bars without moving to log-space sums.
 */

export interface Model {
  k: number;
  dims: number;
  pi: Float64Array;
  trans: Float64Array; // k x k, row-stochastic
  mu: Float64Array; // k x dims
  varr: Float64Array; // k x dims
}

const MIN_VAR = 1e-8;

function gaussianPdf(x: number[], mu: Float64Array, varr: Float64Array, offset: number, dims: number): number {
  let logp = 0;
  for (let d = 0; d < dims; d++) {
    const v = Math.max(MIN_VAR, varr[offset + d]);
    const diff = x[d] - mu[offset + d];
    logp += -0.5 * (Math.log(2 * Math.PI * v) + (diff * diff) / v);
  }
  // Floor keeps a single implausible observation from zeroing an entire path.
  return Math.max(1e-300, Math.exp(logp));
}

function initModel(obs: number[][], k: number, seed: number): Model {
  const dims = obs[0].length;
  const km = kmeans(obs, k, seed, 40);
  const pi = new Float64Array(k).fill(1 / k);
  const trans = new Float64Array(k * k);
  const mu = new Float64Array(k * dims);
  const varr = new Float64Array(k * dims).fill(1);

  for (let c = 0; c < k; c++) {
    const rows = obs.filter((_, i) => km.labels[i] === c);
    for (let d = 0; d < dims; d++) {
      const col = rows.length ? rows.map((r) => r[d]) : obs.map((r) => r[d]);
      mu[c * dims + d] = mean(col);
      varr[c * dims + d] = Math.max(MIN_VAR, stdev(col, 1) ** 2 || 1);
    }
  }
  // Sticky prior: regimes persist, so start with most of the mass on the diagonal.
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) trans[i * k + j] = i === j ? 0.9 : 0.1 / (k - 1);
  }
  return { k, dims, pi, trans, mu, varr };
}

export interface HmmFit {
  model: Model;
  logLikelihood: number;
  iterations: number;
  gamma: Float64Array;
}

/** Dirichlet pseudo-count added to the diagonal of the transition matrix,
 *  expressed as a fraction of the sample length. Market regimes last months,
 *  not days: without this "sticky" prior the unconstrained fit happily flips
 *  state every couple of weeks and the atlas becomes noise. */
const STICKINESS = 0.03;

export function fitGaussianHmm(
  obs: number[][],
  k: number,
  maxIter = 60,
  seed = 11,
  tol = 1e-4,
): HmmFit {
  const n = obs.length;
  const model = initModel(obs, k, seed);
  const { dims } = model;
  const B = new Float64Array(n * k);
  const alpha = new Float64Array(n * k);
  const beta = new Float64Array(n * k);
  const scale = new Float64Array(n);
  const gamma = new Float64Array(n * k);
  const xiSum = new Float64Array(k * k);
  let logLik = -Infinity;
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Emission matrix.
    for (let t = 0; t < n; t++) {
      for (let i = 0; i < k; i++) {
        B[t * k + i] = gaussianPdf(obs[t], model.mu, model.varr, i * dims, dims);
      }
    }

    // Forward pass with per-step scaling.
    let ll = 0;
    let s = 0;
    for (let i = 0; i < k; i++) {
      alpha[i] = model.pi[i] * B[i];
      s += alpha[i];
    }
    s = s || 1e-300;
    scale[0] = s;
    for (let i = 0; i < k; i++) alpha[i] /= s;
    ll += Math.log(s);

    for (let t = 1; t < n; t++) {
      s = 0;
      for (let j = 0; j < k; j++) {
        let acc = 0;
        for (let i = 0; i < k; i++) acc += alpha[(t - 1) * k + i] * model.trans[i * k + j];
        const v = acc * B[t * k + j];
        alpha[t * k + j] = v;
        s += v;
      }
      s = s || 1e-300;
      scale[t] = s;
      for (let j = 0; j < k; j++) alpha[t * k + j] /= s;
      ll += Math.log(s);
    }

    // Backward pass using the same scaling factors.
    for (let i = 0; i < k; i++) beta[(n - 1) * k + i] = 1;
    for (let t = n - 2; t >= 0; t--) {
      for (let i = 0; i < k; i++) {
        let acc = 0;
        for (let j = 0; j < k; j++) {
          acc += model.trans[i * k + j] * B[(t + 1) * k + j] * beta[(t + 1) * k + j];
        }
        beta[t * k + i] = acc / (scale[t + 1] || 1e-300);
      }
    }

    // E-step responsibilities.
    for (let t = 0; t < n; t++) {
      let norm = 0;
      for (let i = 0; i < k; i++) {
        const g = alpha[t * k + i] * beta[t * k + i];
        gamma[t * k + i] = g;
        norm += g;
      }
      norm = norm || 1e-300;
      for (let i = 0; i < k; i++) gamma[t * k + i] /= norm;
    }

    xiSum.fill(0);
    for (let t = 0; t < n - 1; t++) {
      let norm = 0;
      const contrib = new Float64Array(k * k);
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          const v =
            alpha[t * k + i] *
            model.trans[i * k + j] *
            B[(t + 1) * k + j] *
            beta[(t + 1) * k + j];
          contrib[i * k + j] = v;
          norm += v;
        }
      }
      norm = norm || 1e-300;
      for (let idx = 0; idx < k * k; idx++) xiSum[idx] += contrib[idx] / norm;
    }

    // M-step.
    for (let i = 0; i < k; i++) model.pi[i] = Math.max(1e-6, gamma[i]);
    const piNorm = model.pi.reduce((a, b) => a + b, 0);
    for (let i = 0; i < k; i++) model.pi[i] /= piNorm;

    const stickyPrior = STICKINESS * n;
    for (let i = 0; i < k; i++) {
      let rowSum = 0;
      for (let j = 0; j < k; j++) rowSum += xiSum[i * k + j];
      rowSum += stickyPrior;
      rowSum = rowSum || 1e-300;
      for (let j = 0; j < k; j++) {
        const prior = i === j ? stickyPrior : 0;
        model.trans[i * k + j] = Math.max(1e-6, (xiSum[i * k + j] + prior) / rowSum);
      }
      let renorm = 0;
      for (let j = 0; j < k; j++) renorm += model.trans[i * k + j];
      for (let j = 0; j < k; j++) model.trans[i * k + j] /= renorm;
    }

    for (let i = 0; i < k; i++) {
      let weight = 0;
      for (let t = 0; t < n; t++) weight += gamma[t * k + i];
      weight = weight || 1e-300;
      for (let d = 0; d < dims; d++) {
        let acc = 0;
        for (let t = 0; t < n; t++) acc += gamma[t * k + i] * obs[t][d];
        model.mu[i * dims + d] = acc / weight;
      }
      for (let d = 0; d < dims; d++) {
        let acc = 0;
        const m = model.mu[i * dims + d];
        for (let t = 0; t < n; t++) {
          const diff = obs[t][d] - m;
          acc += gamma[t * k + i] * diff * diff;
        }
        model.varr[i * dims + d] = Math.max(MIN_VAR, acc / weight);
      }
    }

    if (Number.isFinite(logLik) && Math.abs(ll - logLik) < tol * Math.abs(logLik)) {
      logLik = ll;
      break;
    }
    logLik = ll;
  }

  return { model, logLikelihood: logLik, iterations, gamma };
}

/** Most likely state sequence, decoded in log-space. */
export function viterbi(obs: number[][], model: Model): Int32Array {
  const n = obs.length;
  const { k, dims } = model;
  const delta = new Float64Array(n * k);
  const psi = new Int32Array(n * k);
  const logTrans = new Float64Array(k * k);
  for (let i = 0; i < k * k; i++) logTrans[i] = Math.log(Math.max(1e-12, model.trans[i]));

  for (let i = 0; i < k; i++) {
    delta[i] =
      Math.log(Math.max(1e-12, model.pi[i])) +
      Math.log(gaussianPdf(obs[0], model.mu, model.varr, i * dims, dims));
  }
  for (let t = 1; t < n; t++) {
    for (let j = 0; j < k; j++) {
      let best = -Infinity;
      let arg = 0;
      for (let i = 0; i < k; i++) {
        const v = delta[(t - 1) * k + i] + logTrans[i * k + j];
        if (v > best) {
          best = v;
          arg = i;
        }
      }
      delta[t * k + j] =
        best + Math.log(gaussianPdf(obs[t], model.mu, model.varr, j * dims, dims));
      psi[t * k + j] = arg;
    }
  }

  const path = new Int32Array(n);
  let best = -Infinity;
  for (let i = 0; i < k; i++) {
    if (delta[(n - 1) * k + i] > best) {
      best = delta[(n - 1) * k + i];
      path[n - 1] = i;
    }
  }
  for (let t = n - 2; t >= 0; t--) path[t] = psi[(t + 1) * k + path[t + 1]];
  return path;
}

/** Build the regime observation matrix from benchmark prices. */
export function regimeObservations(benchmark: Float64Array): number[][] {
  const n = benchmark.length;
  const ret = new Float64Array(n);
  for (let t = 1; t < n; t++) ret[t] = benchmark[t] / benchmark[t - 1] - 1;

  const obs: number[][] = [];
  const shortWin = 21;
  const longWin = 126;
  for (let t = 0; t < n; t++) {
    const a = Math.max(0, t - shortWin + 1);
    const b = Math.max(0, t - longWin + 1);
    let shortMean = 0;
    for (let i = a; i <= t; i++) shortMean += ret[i];
    shortMean /= t - a + 1;
    let absMean = 0;
    for (let i = a; i <= t; i++) absMean += Math.abs(ret[i]);
    absMean /= t - a + 1;
    let longMean = 0;
    for (let i = b; i <= t; i++) longMean += ret[i];
    longMean /= t - b + 1;
    let longAbs = 0;
    for (let i = b; i <= t; i++) longAbs += Math.abs(ret[i]);
    longAbs /= t - b + 1;
    // Scaled so every column lands in roughly the same numeric range.
    obs.push([
      shortMean * 100,
      absMean * 100,
      longMean * 100,
      Math.log(Math.max(1e-6, absMean / Math.max(1e-6, longAbs))),
    ]);
  }
  return obs;
}

/** Fit the regime model on the benchmark and label the states in plain terms. */
export function detectRegimes(
  benchmark: Float64Array,
  k: number,
  seed = 11,
): RegimeTimeline {
  const obs = regimeObservations(benchmark);
  const fit = fitGaussianHmm(obs, k, 60, seed);
  const rawPath = viterbi(obs, fit.model);
  const n = rawPath.length;

  // EM can leave a state with (almost) no decoded bars. Such a state adds an
  // empty column to every regime view, so collapse the path onto the states
  // that actually occur.
  const counts = new Array<number>(k).fill(0);
  for (let t = 0; t < n; t++) counts[rawPath[t]]++;
  const kept = counts.map((count, id) => ({ id, count })).filter((s) => s.count / n >= 0.005);
  const remap = new Map<number, number>();
  kept.forEach((state, index) => remap.set(state.id, index));
  const path = new Int32Array(n);
  for (let t = 0; t < n; t++) path[t] = remap.get(rawPath[t]) ?? 0;
  const states = kept.length;

  const ret = new Float64Array(n);
  for (let t = 1; t < n; t++) ret[t] = benchmark[t] / benchmark[t - 1] - 1;

  const buckets: number[][] = Array.from({ length: states }, () => []);
  for (let t = 0; t < n; t++) buckets[path[t]].push(ret[t]);

  const segments: { state: number; start: number; end: number }[] = [];
  let start = 0;
  for (let t = 1; t <= n; t++) {
    if (t === n || path[t] !== path[start]) {
      segments.push({ state: path[start], start, end: t - 1 });
      start = t;
    }
  }

  const lengths: number[][] = Array.from({ length: states }, () => []);
  for (const seg of segments) lengths[seg.state].push(seg.end - seg.start + 1);

  const raw = buckets.map((rs, id) => ({
    id,
    share: rs.length / n,
    meanReturn: rs.length ? mean(rs) * 252 : 0,
    vol: rs.length > 1 ? stdev(rs, 1) * Math.sqrt(252) : 0,
    avgLength: lengths[id].length ? mean(lengths[id]) : 0,
  }));

  return {
    states: labelStates(raw),
    path,
    segments,
    logLikelihood: fit.logLikelihood,
    iterations: fit.iterations,
  };
}

/**
 * Turn fitted moments into readable regime names.
 *
 * Naming from drift alone produces duplicates (a bullish sample yields several
 * positive-drift states that differ only in volatility), and naming from
 * absolute levels produces nonsense in a sample with no bear market. Each state
 * is therefore classified on two relative axes — its drift rank among the
 * fitted states, and its volatility against their median — and named from the
 * pair, with the sign of the drift deciding between the bearish and the merely
 * sluggish variants.
 */
function labelStates(
  raw: { id: number; share: number; meanReturn: number; vol: number; avgLength: number }[],
): RegimeState[] {
  const byDrift = [...raw].slice().sort((a, b) => b.meanReturn - a.meanReturn);
  const rank = new Map<number, number>();
  byDrift.forEach((state, index) => rank.set(state.id, index));
  const vols = raw.map((r) => r.vol).sort((a, b) => a - b);
  const medianVol = vols[Math.floor(vols.length / 2)] ?? 0;
  const count = raw.length;

  const used = new Map<string, number>();

  return raw.map((state) => {
    const position = rank.get(state.id) ?? 0;
    const driftClass =
      count <= 2
        ? position === 0
          ? "high"
          : "low"
        : position < count / 3
          ? "high"
          : position >= (2 * count) / 3
            ? "low"
            : "mid";
    const highVol = state.vol > medianVol * 1.1;
    const negative = state.meanReturn < 0;

    let label: string;
    let tone: RegimeState["tone"];
    if (driftClass === "high") {
      label = highVol ? "Momentum Surge" : "Calm Uptrend";
      tone = "bull";
    } else if (driftClass === "low") {
      if (negative) {
        label = highVol ? "Stress Selloff" : "Grinding Bear";
        tone = highVol ? "stress" : "bear";
      } else {
        label = highVol ? "Volatile Fade" : "Slow Drift";
        tone = highVol ? "chop" : "calm";
      }
    } else {
      label = highVol ? "Choppy / High Vol" : "Quiet Grind";
      tone = highVol ? "chop" : "calm";
    }

    const seen = (used.get(label) ?? 0) + 1;
    used.set(label, seen);
    return { ...state, tone, label: seen > 1 ? `${label} ${seen}` : label };
  });
}
