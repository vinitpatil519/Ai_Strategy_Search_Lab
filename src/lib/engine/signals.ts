import type { MarketContext } from "./context";
import type { Genome } from "./types";

/** The rule engine.
 *
 *  Every family compiles its parameter vector into one target-direction series
 *  in [-1, 1], evaluated on the bar's close. The backtester lags it by a full
 *  bar before any money is put to work, so nothing here can look ahead.
 *  NaN slots (indicator warm-up) are emitted as 0 = flat.
 */
export function computeSignal(ctx: MarketContext, g: Genome): Float64Array {
  switch (g.family) {
    case "trend":
      return trendSignal(ctx, g);
    case "breakout":
      return breakoutSignal(ctx, g);
    case "meanReversion":
      return meanReversionSignal(ctx, g);
    case "carry":
      return carrySignal(ctx, g);
    case "volatility":
      return volatilitySignal(ctx, g);
    default:
      return new Float64Array(ctx.bars);
  }
}

/** Mask a raw direction by the genome's allowed side. */
function applySide(out: Float64Array, side: Genome["side"]): Float64Array {
  if (side === "both") return out;
  const keep = side === "long" ? 1 : -1;
  for (let i = 0; i < out.length; i++) {
    if (Math.sign(out[i]) !== keep) out[i] = 0;
  }
  return out;
}

function trendSignal(ctx: MarketContext, g: Genome): Float64Array {
  const { fast, slow, confirm, band } = g.params;
  const f = ctx.sma(g.symbol, Math.round(fast));
  const s = ctx.sma(g.symbol, Math.round(slow));
  const r = ctx.roc(g.symbol, Math.round(confirm));
  const out = new Float64Array(ctx.bars);
  for (let i = 0; i < ctx.bars; i++) {
    if (Number.isNaN(f[i]) || Number.isNaN(s[i]) || Number.isNaN(r[i]) || s[i] === 0) continue;
    const spread = f[i] / s[i] - 1;
    if (spread > band && r[i] > 0) out[i] = 1;
    else if (spread < -band && r[i] < 0) out[i] = -1;
  }
  return applySide(out, g.side);
}

function breakoutSignal(ctx: MarketContext, g: Genome): Float64Array {
  const entry = Math.round(g.params.entry);
  const exit = Math.round(g.params.exit);
  const volWindow = Math.round(g.params.volWindow);
  const ceil = g.params.volCeil;
  const s = ctx.series(g.symbol);
  // Shift the channel by one bar so the current close is compared to a level
  // that was already known before this bar printed.
  const hi = ctx.donchianHigh(g.symbol, entry);
  const lo = ctx.donchianLow(g.symbol, entry);
  const exitHi = ctx.donchianHigh(g.symbol, exit);
  const exitLo = ctx.donchianLow(g.symbol, exit);
  const volPct = ctx.volPercentile(g.symbol, volWindow, Math.max(60, volWindow * 4));
  const out = new Float64Array(ctx.bars);
  let pos = 0;
  for (let i = 1; i < ctx.bars; i++) {
    const c = s.close[i];
    if (pos === 1 && !Number.isNaN(exitLo[i - 1]) && c < exitLo[i - 1]) pos = 0;
    else if (pos === -1 && !Number.isNaN(exitHi[i - 1]) && c > exitHi[i - 1]) pos = 0;
    if (pos === 0) {
      const calm = Number.isNaN(volPct[i]) ? true : volPct[i] <= ceil;
      if (calm) {
        if (!Number.isNaN(hi[i - 1]) && c > hi[i - 1]) pos = 1;
        else if (!Number.isNaN(lo[i - 1]) && c < lo[i - 1]) pos = -1;
      }
    }
    out[i] = pos;
  }
  return applySide(out, g.side);
}

function meanReversionSignal(ctx: MarketContext, g: Genome): Float64Array {
  const zWindow = Math.round(g.params.zWindow);
  const rsiWindow = Math.round(g.params.rsiWindow);
  const { entryZ, exitZ, rsiBand } = g.params;
  const z = ctx.zscore(g.symbol, zWindow);
  const r = ctx.rsi(g.symbol, rsiWindow);
  const out = new Float64Array(ctx.bars);
  let pos = 0;
  for (let i = 0; i < ctx.bars; i++) {
    const zi = z[i];
    const ri = r[i];
    if (Number.isNaN(zi) || Number.isNaN(ri)) {
      out[i] = 0;
      pos = 0;
      continue;
    }
    if (pos !== 0 && Math.abs(zi) <= exitZ) pos = 0;
    if (pos === 0) {
      if (zi <= -entryZ && ri <= rsiBand) pos = 1;
      else if (zi >= entryZ && ri >= 100 - rsiBand) pos = -1;
    }
    out[i] = pos;
  }
  return applySide(out, g.side);
}

function carrySignal(ctx: MarketContext, g: Genome): Float64Array {
  const lookback = Math.round(g.params.lookback);
  const smooth = Math.round(g.params.smooth);
  const { threshold, decay } = g.params;
  const ir = ctx.carryIr(g.symbol, lookback, smooth);
  const release = threshold * decay;
  const out = new Float64Array(ctx.bars);
  let pos = 0;
  for (let i = 0; i < ctx.bars; i++) {
    const v = ir[i];
    if (Number.isNaN(v)) {
      out[i] = 0;
      pos = 0;
      continue;
    }
    if (pos === 1 && v < release) pos = 0;
    else if (pos === -1 && v > -release) pos = 0;
    if (pos === 0) {
      if (v > threshold) pos = 1;
      else if (v < -threshold) pos = -1;
    }
    // Scale exposure with conviction, capped at 1.
    out[i] = pos === 0 ? 0 : pos * Math.min(1, Math.abs(v) / Math.max(0.1, threshold * 2));
  }
  return applySide(out, g.side);
}

function volatilitySignal(ctx: MarketContext, g: Genome): Float64Array {
  const volWindow = Math.round(g.params.volWindow);
  const pctWindow = Math.round(g.params.pctWindow);
  const { lowPct, highPct } = g.params;
  const flip = Math.round(g.params.mode) === 1 ? -1 : 1;
  const pct = ctx.volPercentile(g.symbol, volWindow, pctWindow);
  const out = new Float64Array(ctx.bars);
  for (let i = 0; i < ctx.bars; i++) {
    const p = pct[i];
    if (Number.isNaN(p)) continue;
    if (p <= lowPct) out[i] = flip * Math.min(1, (lowPct - p) / Math.max(0.05, lowPct) + 0.4);
    else if (p >= highPct) {
      out[i] = -flip * Math.min(1, (p - highPct) / Math.max(0.05, 1 - highPct) + 0.4);
    }
  }
  return applySide(out, g.side);
}
