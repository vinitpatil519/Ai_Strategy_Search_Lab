import {
  atr,
  logReturns,
  realizedVol,
  rollingMax,
  rollingMin,
  rollingPercentile,
  rollingStdev,
  roc,
  smoothIgnoringNaN,
  rsi,
  simpleReturns,
  sma,
  zscore,
} from "./indicators";
import type { Series, Universe } from "./types";

/** Per-universe indicator cache.
 *
 *  A genetic run evaluates tens of thousands of genomes over the same handful
 *  of price series, and most of them ask for the same windows. Computing each
 *  kernel once per (symbol, kernel, window) turns the search from
 *  indicator-bound into loop-bound: on a 3k-bar universe the cache typically
 *  serves well over 95% of requests after the first generation.
 */
export class MarketContext {
  readonly universe: Universe;
  readonly dates: string[];
  readonly bars: number;
  readonly benchReturns: Float64Array;
  private readonly bySymbol = new Map<string, Series>();
  private readonly cache = new Map<string, Float64Array>();

  constructor(universe: Universe) {
    this.universe = universe;
    this.dates = universe.dates;
    this.bars = universe.dates.length;
    for (const s of universe.series) this.bySymbol.set(s.symbol, s);
    this.benchReturns = simpleReturns(universe.benchmark);
  }

  series(symbol: string): Series {
    const s = this.bySymbol.get(symbol);
    if (!s) throw new Error(`Unknown symbol: ${symbol}`);
    return s;
  }

  private memo(key: string, build: () => Float64Array): Float64Array {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const built = build();
    this.cache.set(key, built);
    return built;
  }

  returns(symbol: string): Float64Array {
    return this.memo(`${symbol}:ret`, () => simpleReturns(this.series(symbol).close));
  }

  logReturns(symbol: string): Float64Array {
    return this.memo(`${symbol}:lret`, () => logReturns(this.series(symbol).close));
  }

  sma(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:sma:${w}`, () => sma(this.series(symbol).close, w));
  }

  roc(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:roc:${w}`, () => roc(this.series(symbol).close, w));
  }

  rsi(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:rsi:${w}`, () => rsi(this.series(symbol).close, w));
  }

  zscore(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:z:${w}`, () => zscore(this.series(symbol).close, w));
  }

  atr(symbol: string, w = 14): Float64Array {
    return this.memo(`${symbol}:atr:${w}`, () => {
      const s = this.series(symbol);
      return atr(s.high, s.low, s.close, w);
    });
  }

  donchianHigh(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:dch:${w}`, () => rollingMax(this.series(symbol).high, w));
  }

  donchianLow(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:dcl:${w}`, () => rollingMin(this.series(symbol).low, w));
  }

  realizedVol(symbol: string, w: number): Float64Array {
    return this.memo(`${symbol}:rv:${w}`, () => realizedVol(this.returns(symbol), w));
  }

  volPercentile(symbol: string, volWindow: number, rankWindow: number): Float64Array {
    return this.memo(`${symbol}:vpct:${volWindow}:${rankWindow}`, () =>
      rollingPercentile(this.realizedVol(symbol, volWindow), rankWindow),
    );
  }

  /** Rolling information ratio of the asset against the equal-weight index. */
  carryIr(symbol: string, lookback: number, smooth: number): Float64Array {
    return this.memo(`${symbol}:carry:${lookback}:${smooth}`, () => {
      const ret = this.returns(symbol);
      const spread = new Float64Array(this.bars);
      for (let i = 0; i < this.bars; i++) spread[i] = ret[i] - this.benchReturns[i];
      const mu = sma(spread, lookback);
      const sd = rollingStdev(spread, lookback);
      const ir = new Float64Array(this.bars).fill(Number.NaN);
      for (let i = 0; i < this.bars; i++) {
        if (Number.isNaN(mu[i]) || Number.isNaN(sd[i]) || sd[i] === 0) continue;
        ir[i] = (mu[i] / sd[i]) * Math.sqrt(252);
      }
      return smooth > 1 ? smoothIgnoringNaN(ir, smooth) : ir;
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
