import { mulberry32, gauss, hashSeed, type Rng } from "./rng";
import type { Series, Universe } from "./types";

/** Synthetic market generator.
 *
 *  The lab needs price history that is offline, reproducible and regime-rich.
 *  Rather than shipping a vendor file, we simulate a small cross-asset universe
 *  from a shared latent regime chain: a 4-state Markov process sets the market
 *  drift and volatility level, and each instrument loads on that market factor
 *  with its own beta, idiosyncratic vol, autocorrelation and jump intensity.
 *  The result has trends, crashes, chop and vol clustering — exactly the
 *  structure the regime model and the strategy families are meant to find.
 */

interface AssetSpec {
  symbol: string;
  label: string;
  assetClass: string;
  start: number;
  beta: number;
  drift: number;
  idioVol: number;
  /** Return autocorrelation: positive trends, negative mean-reverts. */
  momentum: number;
  jumpProb: number;
  jumpScale: number;
}

const ASSETS: AssetSpec[] = [
  { symbol: "EQIX", label: "Broad Equity Index", assetClass: "Equity", start: 2800, beta: 1.0, drift: 0.07, idioVol: 0.05, momentum: 0.05, jumpProb: 0.004, jumpScale: 0.03 },
  { symbol: "TECH", label: "Growth / Tech Basket", assetClass: "Equity", start: 1400, beta: 1.35, drift: 0.11, idioVol: 0.12, momentum: 0.09, jumpProb: 0.007, jumpScale: 0.045 },
  { symbol: "DEFN", label: "Low-Beta Defensives", assetClass: "Equity", start: 640, beta: 0.55, drift: 0.05, idioVol: 0.06, momentum: 0.02, jumpProb: 0.003, jumpScale: 0.02 },
  { symbol: "GOLD", label: "Gold", assetClass: "Metals", start: 1750, beta: -0.25, drift: 0.04, idioVol: 0.11, momentum: 0.04, jumpProb: 0.005, jumpScale: 0.03 },
  { symbol: "CRUD", label: "Crude Oil", assetClass: "Energy", start: 72, beta: 0.45, drift: 0.02, idioVol: 0.26, momentum: 0.08, jumpProb: 0.012, jumpScale: 0.07 },
  { symbol: "BOND", label: "Long Duration Bonds", assetClass: "Rates", start: 108, beta: -0.35, drift: 0.02, idioVol: 0.05, momentum: 0.03, jumpProb: 0.002, jumpScale: 0.015 },
  { symbol: "FXEM", label: "EM FX Carry Basket", assetClass: "FX", start: 96, beta: 0.6, drift: 0.03, idioVol: 0.08, momentum: -0.06, jumpProb: 0.009, jumpScale: 0.04 },
  { symbol: "DGTL", label: "Digital Assets", assetClass: "Crypto", start: 420, beta: 1.6, drift: 0.18, idioVol: 0.42, momentum: 0.12, jumpProb: 0.018, jumpScale: 0.11 },
];

/** Latent market regimes: [annual drift, annual vol, mean duration in bars]. */
const REGIMES = [
  { name: "expansion", drift: 0.18, vol: 0.11, duration: 260 },
  { name: "chop", drift: 0.02, vol: 0.15, duration: 95 },
  { name: "stress", drift: -0.3, vol: 0.34, duration: 38 },
  { name: "recovery", drift: 0.26, vol: 0.2, duration: 75 },
];

/** Row-stochastic transition matrix derived from the mean durations above. */
function transitionMatrix(): number[][] {
  const k = REGIMES.length;
  const next = [
    [0.0, 0.62, 0.28, 0.1],
    [0.5, 0.0, 0.3, 0.2],
    [0.08, 0.22, 0.0, 0.7],
    [0.62, 0.28, 0.1, 0.0],
  ];
  const m: number[][] = [];
  for (let i = 0; i < k; i++) {
    const stay = 1 - 1 / REGIMES[i].duration;
    const row = new Array<number>(k).fill(0);
    row[i] = stay;
    for (let j = 0; j < k; j++) if (j !== i) row[j] = (1 - stay) * next[i][j];
    m.push(row);
  }
  return m;
}

function businessDates(count: number, startIso: string): string[] {
  const out: string[] = [];
  const d = new Date(`${startIso}T00:00:00Z`);
  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function drawState(rng: Rng, row: number[]): number {
  const u = rng();
  let acc = 0;
  for (let i = 0; i < row.length; i++) {
    acc += row[i];
    if (u <= acc) return i;
  }
  return row.length - 1;
}

export interface GeneratedUniverse extends Universe {
  /** The ground-truth regime path used by the generator. Never fed to the
   *  regime model — kept only so the UI can show how close the fit landed. */
  trueRegimePath: Int32Array;
  regimeNames: string[];
}

export function generateUniverse(
  seed: number,
  bars = 3024,
  startIso = "2013-01-02",
): GeneratedUniverse {
  const rng = mulberry32(seed);
  const trans = transitionMatrix();
  const dates = businessDates(bars, startIso);

  // 1. Latent regime path + market factor returns.
  const regimePath = new Int32Array(bars);
  const marketRet = new Float64Array(bars);
  let state = 0;
  // Stochastic-vol multiplier keeps volatility clustered inside a regime.
  let volMult = 1;
  for (let t = 0; t < bars; t++) {
    state = t === 0 ? 0 : drawState(rng, trans[state]);
    regimePath[t] = state;
    const r = REGIMES[state];
    volMult = 0.92 * volMult + 0.08 * 1 + 0.12 * gauss(rng);
    volMult = Math.max(0.45, Math.min(2.6, volMult));
    const dailyVol = (r.vol / Math.sqrt(252)) * volMult;
    marketRet[t] = r.drift / 252 + dailyVol * gauss(rng);
  }

  // 2. Instrument paths: factor loading + idiosyncratic AR(1) + jumps.
  const series: Series[] = ASSETS.map((spec) => {
    const arng = mulberry32(seed ^ hashSeed(spec.symbol));
    const close = new Float64Array(bars);
    const open = new Float64Array(bars);
    const high = new Float64Array(bars);
    const low = new Float64Array(bars);
    const volume = new Float64Array(bars);
    let price = spec.start;
    let prevRet = 0;
    for (let t = 0; t < bars; t++) {
      const idio = (spec.idioVol / Math.sqrt(252)) * gauss(arng);
      let ret = spec.drift / 252 + spec.beta * marketRet[t] + idio + spec.momentum * prevRet;
      if (arng() < spec.jumpProb) ret += spec.jumpScale * gauss(arng);
      // Soft bound: keeps a single draw from producing a nonsense gap.
      ret = Math.max(-0.28, Math.min(0.28, ret));
      prevRet = ret;
      const prevClose = price;
      price = Math.max(0.5, price * (1 + ret));
      const bodyVol = Math.abs(ret) + 0.004;
      open[t] = t === 0 ? spec.start : prevClose * (1 + 0.28 * bodyVol * gauss(arng));
      const hi = Math.max(open[t], price) * (1 + Math.abs(gauss(arng)) * bodyVol * 0.6);
      const lo = Math.min(open[t], price) * (1 - Math.abs(gauss(arng)) * bodyVol * 0.6);
      high[t] = hi;
      low[t] = Math.max(0.2, lo);
      close[t] = price;
      volume[t] = Math.round(1e6 * (1 + 3 * Math.abs(ret) / bodyVol) * (0.7 + 0.6 * arng()));
    }
    return { symbol: spec.symbol, label: spec.label, assetClass: spec.assetClass, dates, open, high, low, close, volume };
  });

  return {
    id: `synthetic-${seed}`,
    label: "Synthetic Cross-Asset Universe",
    dates,
    series,
    benchmark: equalWeightIndex(series),
    trueRegimePath: regimePath,
    regimeNames: REGIMES.map((r) => r.name),
  };
}

/** Equal-weight, daily-rebalanced index across the universe. */
export function equalWeightIndex(series: Series[]): Float64Array {
  const n = series[0].close.length;
  const out = new Float64Array(n);
  out[0] = 100;
  for (let t = 1; t < n; t++) {
    let sum = 0;
    for (const s of series) sum += s.close[t] / s.close[t - 1] - 1;
    out[t] = out[t - 1] * (1 + sum / series.length);
  }
  return out;
}

export const ASSET_SPECS = ASSETS.map((a) => ({
  symbol: a.symbol,
  label: a.label,
  assetClass: a.assetClass,
}));
