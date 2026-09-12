import type { FamilyId } from "./engine/types";

/**
 * One palette for the whole lab.
 *
 * Hues are assigned by meaning, not by index: each strategy family owns a hue
 * it keeps in every chart, table and badge, regime tones map to an intuitive
 * risk gradient, and the cluster ramp is a separate perceptually-spaced set so
 * a cluster is never confused with a family.
 */

export const FAMILY_COLORS: Record<FamilyId, string> = {
  trend: "#35e0a1",
  breakout: "#ff7a45",
  meanReversion: "#6b8cff",
  carry: "#f2c94c",
  volatility: "#f4506c",
};

export const FAMILY_SOFT: Record<FamilyId, string> = {
  trend: "rgba(53,224,161,0.14)",
  breakout: "rgba(255,122,69,0.14)",
  meanReversion: "rgba(107,140,255,0.14)",
  carry: "rgba(242,201,76,0.14)",
  volatility: "rgba(244,80,108,0.14)",
};

export const REGIME_COLORS: Record<string, string> = {
  bull: "#35e0a1",
  calm: "#4fb3d9",
  chop: "#f2c94c",
  bear: "#ff9f6e",
  stress: "#f4506c",
};

export const CLUSTER_RAMP = [
  "#6b8cff",
  "#35e0a1",
  "#ff7a45",
  "#c77dff",
  "#f2c94c",
  "#4fd1c5",
  "#f4506c",
  "#8b95a5",
];

export function clusterColor(id: number): string {
  return CLUSTER_RAMP[((id % CLUSTER_RAMP.length) + CLUSTER_RAMP.length) % CLUSTER_RAMP.length];
}

/** Diverging ramp for heatmaps: red through neutral to green. */
export function divergingColor(value: number, scale = 1.5): string {
  const t = Math.max(-1, Math.min(1, value / scale));
  if (t >= 0) {
    const a = 0.1 + 0.68 * t;
    return `rgba(53,224,161,${a.toFixed(3)})`;
  }
  const a = 0.1 + 0.68 * -t;
  return `rgba(244,80,108,${a.toFixed(3)})`;
}

export function heatTextColor(value: number, scale = 1.5): string {
  return Math.abs(value) / scale > 0.55 ? "#08090b" : "#dfe4ea";
}
