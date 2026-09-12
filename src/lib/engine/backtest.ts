import type { MarketContext } from "./context";
import { computeSignal } from "./signals";
import { clamp } from "./stats";
import type { BacktestResult, Genome, TradeRecord } from "./types";

export interface CostModel {
  /** Commission + fees charged on traded notional, in basis points. */
  costBps: number;
  /** Extra slippage charged on traded notional, in basis points. */
  slippageBps: number;
}

const SIZING_VOL_WINDOW = 20;
const ATR_WINDOW = 14;
/** Only re-size an open position once the target drifts this far away, so
 *  vol-target sizing does not generate a trade on every single bar. */
const RESIZE_TOLERANCE = 0.2;

/**
 * Single-pass path-dependent backtester.
 *
 * Execution model:
 *  - the signal is read at the close of bar t and the resulting exposure is
 *    held over bar t+1, so no decision uses information from its own bar;
 *  - stops and targets are placed at entry from the ATR and filled intrabar
 *    against that bar's high/low, with the stop assumed to fill first when a
 *    bar touches both;
 *  - costs are charged on the absolute change in exposure each time the book
 *    moves, which makes turnover directly comparable across families.
 */
export function runBacktest(ctx: MarketContext, g: Genome, cost: CostModel): BacktestResult {
  const n = ctx.bars;
  const s = ctx.series(g.symbol);
  const close = s.close;
  const high = s.high;
  const low = s.low;
  const signal = computeSignal(ctx, g);
  const vol = ctx.realizedVol(g.symbol, SIZING_VOL_WINDOW);
  const atrArr = ctx.atr(g.symbol, ATR_WINDOW);
  const feeRate = (cost.costBps + cost.slippageBps) / 10_000;

  const returns = new Float64Array(n);
  const position = new Float64Array(n);
  const equity = new Float64Array(n);
  const trades: TradeRecord[] = [];

  let pos = 0;
  let dir: 1 | -1 = 1;
  let stopPrice = 0;
  let targetPrice = 0;
  let barsHeld = 0;
  let coolDown = 0;
  let tradeEntry = -1;
  let tradeGrowth = 1;
  let turnover = 0;
  equity[0] = 1;

  const sizeFor = (t: number, direction: number): number => {
    const v = vol[t];
    const raw = Number.isNaN(v) || v <= 1e-6 ? 0 : g.risk.volTarget / v;
    return clamp(raw, 0, g.risk.maxLeverage) * direction;
  };

  const closeTrade = (t: number, reason: TradeRecord["exitReason"]) => {
    if (tradeEntry >= 0) {
      trades.push({
        entryIndex: tradeEntry,
        exitIndex: t,
        direction: dir,
        returnPct: tradeGrowth - 1,
        bars: Math.max(1, t - tradeEntry),
        exitReason: reason,
      });
    }
    tradeEntry = -1;
    tradeGrowth = 1;
    pos = 0;
    barsHeld = 0;
    stopPrice = 0;
    targetPrice = 0;
  };

  for (let t = 1; t < n; t++) {
    position[t] = pos;
    let barRet = 0;
    let exited: TradeRecord["exitReason"] | null = null;

    if (pos !== 0) {
      const prev = close[t - 1];
      const hitStop = stopPrice > 0 && (dir === 1 ? low[t] <= stopPrice : high[t] >= stopPrice);
      const hitTarget =
        targetPrice > 0 && (dir === 1 ? high[t] >= targetPrice : low[t] <= targetPrice);
      if (hitStop) {
        barRet = pos * (stopPrice / prev - 1);
        exited = "stop";
      } else if (hitTarget) {
        barRet = pos * (targetPrice / prev - 1);
        exited = "target";
      } else {
        barRet = pos * (close[t] / prev - 1);
        barsHeld++;
        if (g.risk.maxHold > 0 && barsHeld >= g.risk.maxHold) exited = "timeout";
      }
    }

    // --- end of bar t: settle any exit, then set the exposure for bar t+1 ---
    let exposureBefore = pos;
    if (exited) {
      const fee = Math.abs(pos) * feeRate;
      barRet -= fee;
      turnover += Math.abs(pos);
      tradeGrowth *= 1 + barRet;
      closeTrade(t, exited);
      exposureBefore = 0;
      coolDown = g.risk.coolDown;
    }

    const desired = Number.isFinite(signal[t]) ? signal[t] : 0;
    let nextPos = exposureBefore;

    if (exposureBefore !== 0) {
      const wantDir = Math.sign(desired);
      if (wantDir !== dir || desired === 0) {
        // Signal flipped or flattened: close at this bar's close.
        nextPos = 0;
      } else {
        const target = sizeFor(t, dir) * Math.abs(desired);
        if (Math.abs(target - exposureBefore) > RESIZE_TOLERANCE * Math.abs(exposureBefore)) {
          nextPos = target;
        }
      }
    } else if (desired !== 0 && coolDown <= 0) {
      dir = desired > 0 ? 1 : -1;
      nextPos = sizeFor(t, dir) * Math.abs(desired);
      if (Math.abs(nextPos) < 1e-4) nextPos = 0;
    }

    if (coolDown > 0) coolDown--;

    const delta = Math.abs(nextPos - exposureBefore);
    if (delta > 1e-9) {
      const fee = delta * feeRate;
      barRet -= fee;
      turnover += delta;
      if (exposureBefore !== 0 && nextPos === 0) {
        tradeGrowth *= 1 + barRet;
        closeTrade(t, "signal");
      } else if (exposureBefore === 0 && nextPos !== 0) {
        tradeEntry = t;
        tradeGrowth = 1;
        barsHeld = 0;
        const a = atrArr[t];
        const ref = close[t];
        if (g.risk.stopAtr > 0 && !Number.isNaN(a)) {
          stopPrice = dir === 1 ? ref - g.risk.stopAtr * a : ref + g.risk.stopAtr * a;
          if (stopPrice <= 0) stopPrice = 0;
        }
        if (g.risk.takeAtr > 0 && !Number.isNaN(a)) {
          targetPrice = dir === 1 ? ref + g.risk.takeAtr * a : ref - g.risk.takeAtr * a;
          if (targetPrice <= 0) targetPrice = 0;
        }
      }
    }

    if (tradeEntry >= 0 && !exited && nextPos !== 0) tradeGrowth *= 1 + barRet;

    returns[t] = barRet;
    equity[t] = equity[t - 1] * (1 + barRet);
    pos = nextPos;
  }

  if (pos !== 0) closeTrade(n - 1, "end");

  return { returns, position, equity, trades, turnover };
}

/** Rebuild an equity curve from a return slice, always starting at 1. */
export function equityFrom(returns: Float64Array, start: number, end: number): Float64Array {
  const out = new Float64Array(Math.max(0, end - start));
  let e = 1;
  for (let i = start; i < end; i++) {
    e *= 1 + returns[i];
    out[i - start] = e;
  }
  return out;
}
