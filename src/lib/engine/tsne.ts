import { gauss, mulberry32 } from "./rng";

export interface TsneOptions {
  perplexity?: number;
  iterations?: number;
  learningRate?: number;
  seed?: number;
  /** Called every 25 iterations with progress in [0,1]. */
  onProgress?: (progress: number) => void;
}

/**
 * t-distributed stochastic neighbour embedding, exact (O(n^2)) variant.
 *
 * The survivor set is a few hundred strategies at most, so the exact gradient
 * is cheaper than building a Barnes-Hut tree and keeps the map deterministic
 * for a given seed. Standard recipe: binary-search each point's bandwidth to
 * hit the requested perplexity, symmetrize P, then run gradient descent with
 * momentum, early exaggeration and adaptive per-dimension gains.
 */
export function tsne(rows: number[][], options: TsneOptions = {}): [number, number][] {
  const n = rows.length;
  if (n === 0) return [];
  if (n < 4) return rows.map((_, i) => [i * 2 - n, 0] as [number, number]);

  const perplexity = Math.max(2, Math.min(options.perplexity ?? 20, Math.floor((n - 1) / 3)));
  const iterations = options.iterations ?? 500;
  const eta = options.learningRate ?? 180;
  const rng = mulberry32(options.seed ?? 42);

  const distances = pairwiseSqDist(rows);
  const P = conditionalProbabilities(distances, perplexity, n);

  // Symmetrize and normalize.
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = (P[i * n + j] + P[j * n + i]) / 2;
      P[i * n + j] = v;
      P[j * n + i] = v;
      sum += 2 * v;
    }
  }
  if (sum > 0) for (let i = 0; i < n * n; i++) P[i] /= sum;

  const Y = new Float64Array(n * 2);
  for (let i = 0; i < n * 2; i++) Y[i] = gauss(rng) * 1e-2;
  const dY = new Float64Array(n * 2);
  const iY = new Float64Array(n * 2);
  const gains = new Float64Array(n * 2).fill(1);
  const Q = new Float64Array(n * n);

  for (let iter = 0; iter < iterations; iter++) {
    const exaggeration = iter < 120 ? 12 : 1;
    const momentum = iter < 250 ? 0.5 : 0.8;

    // Low-dimensional affinities with a Student-t kernel.
    let qSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i * 2] - Y[j * 2];
        const dy = Y[i * 2 + 1] - Y[j * 2 + 1];
        const num = 1 / (1 + dx * dx + dy * dy);
        Q[i * n + j] = num;
        Q[j * n + i] = num;
        qSum += 2 * num;
      }
    }
    if (qSum === 0) qSum = 1e-12;

    dY.fill(0);
    for (let i = 0; i < n; i++) {
      let gx = 0;
      let gy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const q = Q[i * n + j];
        const mult = (exaggeration * P[i * n + j] - q / qSum) * q;
        gx += mult * (Y[i * 2] - Y[j * 2]);
        gy += mult * (Y[i * 2 + 1] - Y[j * 2 + 1]);
      }
      dY[i * 2] = 4 * gx;
      dY[i * 2 + 1] = 4 * gy;
    }

    for (let i = 0; i < n * 2; i++) {
      const sameSign = Math.sign(dY[i]) === Math.sign(iY[i]);
      gains[i] = Math.max(0.01, sameSign ? gains[i] * 0.8 : gains[i] + 0.2);
      iY[i] = momentum * iY[i] - eta * gains[i] * dY[i];
      Y[i] += iY[i];
    }

    // Re-center to keep the embedding from drifting off the viewport.
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += Y[i * 2];
      my += Y[i * 2 + 1];
    }
    mx /= n;
    my /= n;
    for (let i = 0; i < n; i++) {
      Y[i * 2] -= mx;
      Y[i * 2 + 1] -= my;
    }

    if (options.onProgress && iter % 25 === 0) options.onProgress(iter / iterations);
  }

  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([Y[i * 2], Y[i * 2 + 1]]);
  return out;
}

function pairwiseSqDist(rows: number[][]): Float64Array {
  const n = rows.length;
  const dims = rows[0].length;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let d = 0; d < dims; d++) {
        const diff = rows[i][d] - rows[j][d];
        s += diff * diff;
      }
      out[i * n + j] = s;
      out[j * n + i] = s;
    }
  }
  return out;
}

/** Binary search per point for the bandwidth that matches the target perplexity. */
function conditionalProbabilities(
  distances: Float64Array,
  perplexity: number,
  n: number,
): Float64Array {
  const P = new Float64Array(n * n);
  const logU = Math.log(perplexity);
  const row = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    let beta = 1;
    let lo = -Infinity;
    let hi = Infinity;

    for (let step = 0; step < 60; step++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        row[j] = i === j ? 0 : Math.exp(-distances[i * n + j] * beta);
        sum += row[j];
      }
      if (sum === 0) sum = 1e-12;
      let entropy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        entropy += (distances[i * n + j] * beta * row[j]) / sum;
      }
      entropy += Math.log(sum);
      const diff = entropy - logU;
      if (Math.abs(diff) < 1e-5) break;
      if (diff > 0) {
        lo = beta;
        beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
      } else {
        hi = beta;
        beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2;
      }
    }

    let sum = 0;
    for (let j = 0; j < n; j++) {
      row[j] = i === j ? 0 : Math.exp(-distances[i * n + j] * beta);
      sum += row[j];
    }
    if (sum === 0) sum = 1e-12;
    for (let j = 0; j < n; j++) P[i * n + j] = row[j] / sum;
  }
  return P;
}
