import type { FamilyId } from "./types";

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  integer?: boolean;
  step?: number;
  /** Short explanation shown in the strategy editor. */
  hint: string;
}

export interface FamilySpec {
  id: FamilyId;
  label: string;
  blurb: string;
  accent: string;
  params: ParamSpec[];
}

export const FAMILIES: FamilySpec[] = [
  {
    id: "trend",
    label: "Trend",
    blurb: "Dual moving-average state with a rate-of-change confirmation and a neutral band.",
    accent: "acid",
    params: [
      { key: "fast", label: "Fast MA", min: 3, max: 60, integer: true, hint: "Bars in the fast moving average." },
      { key: "slow", label: "Slow MA", min: 20, max: 250, integer: true, hint: "Bars in the slow moving average." },
      { key: "confirm", label: "Confirm ROC", min: 5, max: 150, integer: true, hint: "Rate-of-change lookback that must agree with the crossover." },
      { key: "band", label: "Neutral band", min: 0, max: 0.06, step: 0.001, hint: "Fraction the fast MA must clear the slow MA by before trading." },
    ],
  },
  {
    id: "breakout",
    label: "Breakout",
    blurb: "Donchian channel entry with a shorter opposite channel as the trailing exit.",
    accent: "flare",
    params: [
      { key: "entry", label: "Entry channel", min: 10, max: 200, integer: true, hint: "Lookback for the breakout high/low." },
      { key: "exit", label: "Exit channel", min: 5, max: 100, integer: true, hint: "Shorter channel that closes the position." },
      { key: "volWindow", label: "Vol window", min: 10, max: 120, integer: true, hint: "Window for the realized-volatility filter." },
      { key: "volCeil", label: "Vol ceiling", min: 0.2, max: 1, step: 0.01, hint: "Skip breakouts when vol sits above this percentile." },
    ],
  },
  {
    id: "meanReversion",
    label: "Mean Reversion",
    blurb: "Fade z-score extremes confirmed by RSI, exit back toward the mean.",
    accent: "iris",
    params: [
      { key: "zWindow", label: "Z window", min: 10, max: 150, integer: true, hint: "Lookback for the price z-score." },
      { key: "entryZ", label: "Entry Z", min: 0.6, max: 3.2, step: 0.05, hint: "Standard deviations from the mean required to fade." },
      { key: "exitZ", label: "Exit Z", min: 0, max: 1.6, step: 0.05, hint: "Z-score at which the position is closed." },
      { key: "rsiWindow", label: "RSI window", min: 4, max: 40, integer: true, hint: "RSI lookback used as confirmation." },
      { key: "rsiBand", label: "RSI band", min: 5, max: 40, step: 1, hint: "Distance from 0/100 that counts as exhausted." },
    ],
  },
  {
    id: "carry",
    label: "Carry",
    blurb: "Trade persistent excess drift versus the universe, scaled by its own noise.",
    accent: "acid",
    params: [
      { key: "lookback", label: "Carry window", min: 20, max: 300, integer: true, hint: "Window for excess return versus the equal-weight index." },
      { key: "smooth", label: "Smoothing", min: 2, max: 60, integer: true, hint: "Extra smoothing applied to the carry signal." },
      { key: "threshold", label: "Entry IR", min: 0.05, max: 1.6, step: 0.05, hint: "Information ratio needed before taking the carry." },
      { key: "decay", label: "Exit fraction", min: 0.1, max: 0.9, step: 0.05, hint: "Fraction of the entry threshold that triggers the exit." },
    ],
  },
  {
    id: "volatility",
    label: "Volatility",
    blurb: "Position from the realized-volatility percentile: harvest calm, respect stress.",
    accent: "cherry",
    params: [
      { key: "volWindow", label: "Vol window", min: 5, max: 90, integer: true, hint: "Realized volatility lookback." },
      { key: "pctWindow", label: "Percentile window", min: 60, max: 600, integer: true, hint: "History used to rank the current volatility." },
      { key: "lowPct", label: "Calm cutoff", min: 0.05, max: 0.55, step: 0.01, hint: "Percentile below which volatility counts as calm." },
      { key: "highPct", label: "Stress cutoff", min: 0.45, max: 0.98, step: 0.01, hint: "Percentile above which volatility counts as stressed." },
      { key: "mode", label: "Polarity", min: 0, max: 1, integer: true, hint: "0 buys calm and sells stress, 1 inverts the pair." },
    ],
  },
];

export const FAMILY_BY_ID: Record<FamilyId, FamilySpec> = Object.fromEntries(
  FAMILIES.map((f) => [f.id, f]),
) as Record<FamilyId, FamilySpec>;

export const RISK_SPECS: ParamSpec[] = [
  { key: "volTarget", label: "Vol target", min: 0.04, max: 0.35, step: 0.01, hint: "Annualized volatility the sizer aims for." },
  { key: "maxLeverage", label: "Max leverage", min: 0.25, max: 3, step: 0.05, hint: "Hard cap on gross exposure." },
  { key: "stopAtr", label: "Stop (ATR)", min: 0, max: 8, step: 0.1, hint: "Stop distance in ATR multiples. 0 disables." },
  { key: "takeAtr", label: "Target (ATR)", min: 0, max: 16, step: 0.1, hint: "Profit target in ATR multiples. 0 disables." },
  { key: "maxHold", label: "Max hold", min: 0, max: 160, integer: true, hint: "Bars before a forced exit. 0 disables." },
  { key: "coolDown", label: "Cooldown", min: 0, max: 20, integer: true, hint: "Bars to stand aside after a stop or target." },
];
