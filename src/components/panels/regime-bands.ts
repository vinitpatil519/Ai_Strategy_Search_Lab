import type { Band } from "@/components/charts/LineChart";
import { WARMUP } from "@/lib/engine/search";
import type { SearchRun } from "@/lib/engine/types";
import { REGIME_COLORS } from "@/lib/palette";

function soft(hex: string, alpha = 0.07): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Map the regime path onto chart-space bands.
 *
 * Curves are exported downsampled, so segment bar indices have to be rescaled
 * into the chart's own point index before they can be drawn behind a line.
 */
export function regimeBands(
  run: SearchRun,
  from: number,
  to: number,
  points: number,
  alpha = 0.055,
): Band[] {
  const span = to - from;
  if (span <= 1 || points <= 1) return [];
  return run.regimes.segments
    .filter((seg) => seg.end >= from && seg.start <= to)
    .map((seg) => {
      const tone = run.regimes.states[seg.state]?.tone ?? "chop";
      return {
        from: ((Math.max(seg.start, from) - from) / span) * (points - 1),
        to: ((Math.min(seg.end, to) - from) / span) * (points - 1),
        color: soft(REGIME_COLORS[tone] ?? "#3a4454", alpha),
      };
    });
}

export function oosBands(run: SearchRun, points: number, alpha = 0.055): Band[] {
  return regimeBands(run, run.split.isEnd, run.split.total, points, alpha);
}

export function scoredBands(run: SearchRun, points: number, alpha = 0.055): Band[] {
  return regimeBands(run, WARMUP, run.split.total, points, alpha);
}

/** Nearest-neighbour resample so two exported series of different lengths can
 *  share one x axis. */
export function resample(values: number[], length: number): number[] {
  if (values.length === 0 || length <= 0) return new Array(Math.max(0, length)).fill(Number.NaN);
  if (values.length === length) return values;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const t = length === 1 ? 0 : i / (length - 1);
    out.push(values[Math.min(values.length - 1, Math.round(t * (values.length - 1)))]);
  }
  return out;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
