import { FAMILY_BY_ID, FAMILIES, RISK_SPECS, type ParamSpec } from "./families";
import { pick, randInt, randRange, type Rng } from "./rng";
import { clamp } from "./stats";
import type { FamilyId, Genome, RiskGenes, Side } from "./types";

const SIDES: Side[] = ["long", "short", "both"];

let counter = 0;
export function newId(prefix = "s"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${counter.toString(36).padStart(4, "0")}`;
}

function coerce(spec: ParamSpec, value: number): number {
  const v = clamp(value, spec.min, spec.max);
  if (spec.integer) return Math.round(v);
  // Snap to the schema step, then strip binary-float dust so the value prints
  // as 4.8 rather than 4.800000000000001 wherever it surfaces.
  if (spec.step) {
    const decimals = Math.max(0, Math.ceil(-Math.log10(spec.step)));
    return Number((Math.round(v / spec.step) * spec.step).toFixed(decimals));
  }
  return Number(v.toFixed(6));
}

function randomParam(rng: Rng, spec: ParamSpec): number {
  return coerce(
    spec,
    spec.integer ? randInt(rng, spec.min, spec.max) : randRange(rng, spec.min, spec.max),
  );
}

export function randomRisk(rng: Rng, volTarget: number): RiskGenes {
  return {
    volTarget: clamp(volTarget * randRange(rng, 0.6, 1.4), 0.03, 0.4),
    maxLeverage: coerce(RISK_SPECS[1], randRange(rng, 0.5, 2.2)),
    stopAtr: rng() < 0.45 ? 0 : coerce(RISK_SPECS[2], randRange(rng, 1, 6)),
    takeAtr: rng() < 0.6 ? 0 : coerce(RISK_SPECS[3], randRange(rng, 2, 12)),
    maxHold: rng() < 0.55 ? 0 : randInt(rng, 5, 120),
    coolDown: rng() < 0.7 ? 0 : randInt(rng, 1, 10),
  };
}

export function randomGenome(
  rng: Rng,
  families: FamilyId[],
  symbols: string[],
  volTarget: number,
  generation = 0,
): Genome {
  const family = pick(rng, families.length ? families : FAMILIES.map((f) => f.id));
  const spec = FAMILY_BY_ID[family];
  const params: Record<string, number> = {};
  for (const p of spec.params) params[p.key] = randomParam(rng, p);
  repair(family, params);
  return {
    id: newId(),
    family,
    symbol: pick(rng, symbols),
    side: pick(rng, SIDES),
    params,
    risk: randomRisk(rng, volTarget),
    origin: "seed",
    generation,
  };
}

/** Enforce cross-parameter invariants that random draws can violate. */
export function repair(family: FamilyId, params: Record<string, number>): void {
  switch (family) {
    case "trend":
      if (params.slow <= params.fast) {
        params.slow = params.fast + Math.max(5, Math.round(params.fast * 0.8));
      }
      params.slow = Math.min(250, params.slow);
      break;
    case "breakout":
      if (params.exit >= params.entry) params.exit = Math.max(5, Math.round(params.entry * 0.5));
      break;
    case "meanReversion":
      if (params.exitZ >= params.entryZ) params.exitZ = Math.max(0, params.entryZ - 0.4);
      break;
    case "carry":
      if (params.smooth >= params.lookback) {
        params.smooth = Math.max(2, Math.round(params.lookback * 0.25));
      }
      break;
    case "volatility":
      if (params.highPct <= params.lowPct + 0.05) {
        params.highPct = Math.min(0.98, params.lowPct + 0.2);
      }
      if (params.pctWindow <= params.volWindow * 2) params.pctWindow = params.volWindow * 3;
      break;
  }
}

export function mutate(
  rng: Rng,
  parent: Genome,
  rate: number,
  symbols: string[],
  generation: number,
): Genome {
  const spec = FAMILY_BY_ID[parent.family];
  const params = { ...parent.params };
  for (const p of spec.params) {
    if (rng() > rate) continue;
    const span = p.max - p.min;
    // Gaussian-ish jitter, with an occasional full re-draw to escape local optima.
    const next =
      rng() < 0.15 ? randomParam(rng, p) : params[p.key] + (rng() * 2 - 1) * span * 0.22;
    params[p.key] = coerce(p, next);
  }
  repair(parent.family, params);

  const risk = { ...parent.risk };
  if (rng() < rate) risk.volTarget = clamp(risk.volTarget * randRange(rng, 0.75, 1.3), 0.03, 0.4);
  if (rng() < rate) risk.maxLeverage = coerce(RISK_SPECS[1], risk.maxLeverage * randRange(rng, 0.75, 1.35));
  if (rng() < rate) risk.stopAtr = rng() < 0.3 ? 0 : coerce(RISK_SPECS[2], randRange(rng, 1, 6));
  if (rng() < rate) risk.takeAtr = rng() < 0.45 ? 0 : coerce(RISK_SPECS[3], randRange(rng, 2, 12));
  if (rng() < rate * 0.6) risk.maxHold = rng() < 0.4 ? 0 : randInt(rng, 5, 120);
  if (rng() < rate * 0.4) risk.coolDown = rng() < 0.6 ? 0 : randInt(rng, 1, 10);

  return {
    id: newId(),
    family: parent.family,
    symbol: rng() < rate * 0.35 ? pick(rng, symbols) : parent.symbol,
    side: rng() < rate * 0.3 ? pick(rng, SIDES) : parent.side,
    params,
    risk,
    origin: "mutation",
    generation,
    parents: [parent.id],
  };
}

export function crossover(rng: Rng, a: Genome, b: Genome, generation: number): Genome {
  // Same family: blend the parameter vectors. Different family: inherit the rule
  // set from one parent and a blend of the risk genes from both.
  if (a.family === b.family) {
    const spec = FAMILY_BY_ID[a.family];
    const params: Record<string, number> = {};
    for (const p of spec.params) {
      const w = rng();
      params[p.key] = coerce(p, a.params[p.key] * w + b.params[p.key] * (1 - w));
    }
    repair(a.family, params);
    return {
      id: newId(),
      family: a.family,
      symbol: rng() < 0.5 ? a.symbol : b.symbol,
      side: rng() < 0.5 ? a.side : b.side,
      params,
      risk: blendRisk(rng, a.risk, b.risk),
      origin: "crossover",
      generation,
      parents: [a.id, b.id],
    };
  }
  return {
    id: newId(),
    family: a.family,
    symbol: rng() < 0.5 ? a.symbol : b.symbol,
    side: rng() < 0.5 ? a.side : b.side,
    params: { ...a.params },
    risk: blendRisk(rng, a.risk, b.risk),
    origin: "crossover",
    generation,
    parents: [a.id, b.id],
  };
}

function blendRisk(rng: Rng, a: RiskGenes, b: RiskGenes): RiskGenes {
  const w = rng();
  const mix = (x: number, y: number) => x * w + y * (1 - w);
  return {
    volTarget: clamp(mix(a.volTarget, b.volTarget), 0.03, 0.4),
    maxLeverage: coerce(RISK_SPECS[1], mix(a.maxLeverage, b.maxLeverage)),
    stopAtr: rng() < 0.5 ? a.stopAtr : b.stopAtr,
    takeAtr: rng() < 0.5 ? a.takeAtr : b.takeAtr,
    maxHold: rng() < 0.5 ? a.maxHold : b.maxHold,
    coolDown: rng() < 0.5 ? a.coolDown : b.coolDown,
  };
}

/** Structural distance in [0,1]. Drives the diversity metric and keeps
 *  near-duplicate survivors off the leaderboard. */
export function genomeDistance(a: Genome, b: Genome): number {
  if (a.family !== b.family) return 1;
  const spec = FAMILY_BY_ID[a.family];
  let acc = a.symbol === b.symbol ? 0 : 1;
  let terms = 1;
  for (const p of spec.params) {
    const span = p.max - p.min || 1;
    acc += Math.abs(a.params[p.key] - b.params[p.key]) / span;
    terms++;
  }
  acc += Math.abs(a.risk.volTarget - b.risk.volTarget) / 0.37;
  acc += a.side === b.side ? 0 : 0.5;
  terms += 2;
  return clamp(acc / terms, 0, 1);
}

/** Plain-English rule text for the strategy inspector. */
export function describeGenome(g: Genome): string[] {
  const p = g.params;
  const dir =
    g.side === "long" ? "Long only." : g.side === "short" ? "Short only." : "Long and short.";
  const lines: string[] = [];
  switch (g.family) {
    case "trend":
      lines.push(
        `Go long when the ${p.fast}-bar average sits ${(p.band * 100).toFixed(1)}% above the ${p.slow}-bar average.`,
      );
      lines.push(`Require the ${p.confirm}-bar rate of change to agree with the crossover.`);
      lines.push("Mirror the condition for shorts; stand aside inside the neutral band.");
      break;
    case "breakout":
      lines.push(
        `Enter long on a close above the ${p.entry}-bar high, short below the ${p.entry}-bar low.`,
      );
      lines.push(`Exit when price closes back through the ${p.exit}-bar channel.`);
      lines.push(
        `Skip signals when ${p.volWindow}-bar realized volatility ranks above the ${(p.volCeil * 100).toFixed(0)}th percentile.`,
      );
      break;
    case "meanReversion":
      lines.push(
        `Fade moves beyond ${p.entryZ.toFixed(2)} standard deviations of the ${p.zWindow}-bar mean.`,
      );
      lines.push(
        `Require ${p.rsiWindow}-bar RSI outside ${p.rsiBand.toFixed(0)} / ${(100 - p.rsiBand).toFixed(0)} as confirmation.`,
      );
      lines.push(`Close once the z-score returns inside ${p.exitZ.toFixed(2)}.`);
      break;
    case "carry":
      lines.push(`Measure ${p.lookback}-bar excess return versus the equal-weight universe index.`);
      lines.push(
        `Divide by its own dispersion and smooth over ${p.smooth} bars to get an information ratio.`,
      );
      lines.push(
        `Take the carry beyond ${p.threshold.toFixed(2)} IR, release it below ${(p.threshold * p.decay).toFixed(2)}.`,
      );
      break;
    case "volatility":
      lines.push(`Rank ${p.volWindow}-bar realized volatility inside a ${p.pctWindow}-bar history.`);
      lines.push(
        p.mode === 0
          ? `Hold risk when the rank is below ${(p.lowPct * 100).toFixed(0)}%, sell it above ${(p.highPct * 100).toFixed(0)}%.`
          : `Buy stress above ${(p.highPct * 100).toFixed(0)}% and fade calm below ${(p.lowPct * 100).toFixed(0)}%.`,
      );
      lines.push("Exposure decays back to flat between the two cutoffs.");
      break;
  }
  lines.push(dir);
  const risk: string[] = [
    `Size to ${(g.risk.volTarget * 100).toFixed(0)}% annualized vol, capped at ${g.risk.maxLeverage.toFixed(2)}x.`,
  ];
  if (g.risk.stopAtr > 0) risk.push(`Stop at ${g.risk.stopAtr.toFixed(1)} ATR.`);
  if (g.risk.takeAtr > 0) risk.push(`Target at ${g.risk.takeAtr.toFixed(1)} ATR.`);
  if (g.risk.maxHold > 0) risk.push(`Force an exit after ${g.risk.maxHold} bars.`);
  if (g.risk.coolDown > 0) risk.push(`Wait ${g.risk.coolDown} bars before re-entering.`);
  lines.push(risk.join(" "));
  return lines;
}

export function genomeName(g: Genome): string {
  const fam = FAMILY_BY_ID[g.family].label.replace(/\s+/g, "");
  const key = Object.values(g.params)
    .slice(0, 2)
    .map((v) => (Number.isInteger(v) ? v : v.toFixed(2)))
    .join("-");
  return `${fam}.${g.symbol}.${key}`;
}
