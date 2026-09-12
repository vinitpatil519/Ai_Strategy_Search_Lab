import { mulberry32, type Rng } from "./rng";

export interface KMeansResult {
  labels: Int32Array;
  centroids: number[][];
  inertia: number;
  k: number;
  silhouette: number;
}

function sqDist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

/** k-means++ seeding: spreads the initial centroids by distance weighting so a
 *  single unlucky draw cannot collapse two clusters onto the same region. */
function seedCentroids(rows: number[][], k: number, rng: Rng): number[][] {
  const centroids: number[][] = [rows[Math.floor(rng() * rows.length)].slice()];
  const dist = new Float64Array(rows.length).fill(Infinity);
  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      const d = sqDist(rows[i], last);
      if (d < dist[i]) dist[i] = d;
      total += dist[i];
    }
    if (total === 0) {
      centroids.push(rows[Math.floor(rng() * rows.length)].slice());
      continue;
    }
    let threshold = rng() * total;
    let idx = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      threshold -= dist[i];
      if (threshold <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push(rows[idx].slice());
  }
  return centroids;
}

export function kmeans(rows: number[][], k: number, seed = 7, maxIter = 120): KMeansResult {
  const n = rows.length;
  const dims = rows[0]?.length ?? 0;
  if (n === 0 || k <= 0) {
    return { labels: new Int32Array(0), centroids: [], inertia: 0, k: 0, silhouette: 0 };
  }
  const kk = Math.min(k, n);
  const rng = mulberry32(seed);
  let centroids = seedCentroids(rows, kk, rng);
  const labels = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = sqDist(rows[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        moved = true;
      }
    }
    const sums = Array.from({ length: kk }, () => new Array<number>(dims).fill(0));
    const counts = new Array<number>(kk).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      const row = rows[i];
      const acc = sums[labels[i]];
      for (let d = 0; d < dims; d++) acc[d] += row[d];
    }
    centroids = centroids.map((prev, c) => {
      if (counts[c] === 0) return rows[Math.floor(rng() * n)].slice();
      return sums[c].map((v) => v / counts[c]);
    });
    if (!moved && iter > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += sqDist(rows[i], centroids[labels[i]]);

  return { labels, centroids, inertia, k: kk, silhouette: silhouette(rows, labels, kk) };
}

/** Mean silhouette coefficient in [-1, 1]. */
export function silhouette(rows: number[][], labels: Int32Array, k: number): number {
  const n = rows.length;
  if (n < 3 || k < 2) return 0;
  const members: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) members[labels[i]].push(i);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = members[labels[i]];
    if (own.length <= 1) continue;
    let a = 0;
    for (const j of own) if (j !== i) a += Math.sqrt(sqDist(rows[i], rows[j]));
    a /= own.length - 1;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === labels[i] || members[c].length === 0) continue;
      let d = 0;
      for (const j of members[c]) d += Math.sqrt(sqDist(rows[i], rows[j]));
      d /= members[c].length;
      if (d < b) b = d;
    }
    if (!Number.isFinite(b)) continue;
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}

/**
 * Pick k by silhouette across a small range.
 *
 * Raw silhouette almost always prefers k=2, which collapses the survivor map
 * into one giant blob plus a handful of outliers and tells the researcher
 * nothing. Two corrections: partitions whose smallest cluster is a rounding
 * error are penalized, and a mild bonus rewards a more informative split when
 * the scores are close.
 */
export function autoKMeans(rows: number[][], minK = 3, maxK = 8, seed = 7): KMeansResult {
  const upper = Math.min(maxK, Math.max(minK, Math.floor(rows.length / 5)));
  const lower = Math.min(minK, upper);
  let best: KMeansResult | null = null;
  let bestScore = -Infinity;
  for (let k = lower; k <= upper; k++) {
    const res = kmeans(rows, k, seed + k);
    const counts = new Array<number>(res.k).fill(0);
    for (let i = 0; i < res.labels.length; i++) counts[res.labels[i]]++;
    const smallest = Math.min(...counts) / rows.length;
    const balancePenalty = smallest < 0.04 ? 0.35 : smallest < 0.08 ? 0.12 : 0;
    const spreadBonus = 0.03 * (k - lower);
    const score = res.silhouette - balancePenalty + spreadBonus;
    if (score > bestScore) {
      bestScore = score;
      best = res;
    }
  }
  return best ?? kmeans(rows, Math.min(lower, rows.length), seed);
}
