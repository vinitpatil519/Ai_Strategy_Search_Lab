"use client";

import { useMemo } from "react";
import { cx } from "@/components/ui/primitives";
import { divergingColor } from "@/lib/palette";
import { monthLabel } from "@/lib/format";
import { extent, linePath, linear } from "./scale";

/** Compact inline curve for table rows. */
export function Sparkline({
  values,
  color = "#8b95a5",
  width = 92,
  height = 22,
  baseline,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  baseline?: number;
}) {
  const d = useMemo(() => {
    if (values.length < 2) return "";
    const [lo, hi] = extent(values);
    const y = linear([lo, hi], [height - 2, 2]);
    const x = (i: number) => (i / (values.length - 1)) * width;
    return linePath(values, x, y);
  }, [values, width, height]);

  const baseY = useMemo(() => {
    if (baseline === undefined || values.length < 2) return null;
    const [lo, hi] = extent(values);
    return linear([lo, hi], [height - 2, 2])(baseline);
  }, [baseline, values, height]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      {baseY !== null && (
        <line
          x1={0}
          x2={width}
          y1={baseY}
          y2={baseY}
          stroke="rgba(255,255,255,0.14)"
          strokeDasharray="2 2"
        />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bar used for family and fold comparisons. */
export function BarRow({
  label,
  value,
  max,
  color,
  display,
  sub,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  display: string;
  sub?: string;
}) {
  const width = max === 0 ? 0 : Math.max(0, Math.min(1, Math.abs(value) / max)) * 100;
  const negative = value < 0;
  return (
    <div className="group py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-ink-300">{label}</span>
        <span className="font-mono text-2xs text-ink-200 tnum">{display}</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${width}%`,
            background: negative ? "#f4506c" : color,
            opacity: negative ? 0.75 : 1,
          }}
        />
      </div>
      {sub && <div className="mt-0.5 text-2xs text-ink-500">{sub}</div>}
    </div>
  );
}

/** Regime timeline strip: one coloured band per contiguous state run. */
export function RegimeRibbon({
  path,
  colors,
  labels,
  dates,
  height = 16,
  onHover,
}: {
  path: number[];
  colors: string[];
  labels: string[];
  dates: string[];
  height?: number;
  onHover?: (index: number | null) => void;
}) {
  const segments = useMemo(() => {
    const out: { state: number; from: number; to: number }[] = [];
    if (path.length === 0) return out;
    let start = 0;
    for (let i = 1; i <= path.length; i++) {
      if (i === path.length || path[i] !== path[start]) {
        out.push({ state: path[start], from: start, to: i - 1 });
        start = i;
      }
    }
    return out;
  }, [path]);

  return (
    <div
      className="flex w-full overflow-hidden rounded"
      style={{ height }}
      onMouseLeave={() => onHover?.(null)}
    >
      {segments.map((seg, i) => (
        <div
          key={`${seg.from}-${i}`}
          title={`${labels[seg.state] ?? seg.state}: ${dates[seg.from] ?? ""} to ${dates[seg.to] ?? ""}`}
          onMouseEnter={() => onHover?.(seg.from)}
          style={{
            width: `${((seg.to - seg.from + 1) / path.length) * 100}%`,
            background: colors[seg.state] ?? "#3a4454",
            opacity: 0.8,
          }}
        />
      ))}
    </div>
  );
}

/** Calendar grid of monthly returns: years down, months across. */
export function MonthlyGrid({
  monthly,
  scale = 0.06,
}: {
  monthly: { month: string; ret: number }[];
  scale?: number;
}) {
  const { years, matrix } = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const row of monthly) {
      const [y, m] = row.month.split("-");
      if (!map.has(y)) map.set(y, new Map());
      map.get(y)!.set(Number(m), row.ret);
    }
    const yearList = [...map.keys()].sort();
    return { years: yearList, matrix: map };
  }, [monthly]);

  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="w-10" />
            {months.map((m, i) => (
              <th key={`${m}${i}`} className="text-2xs font-normal text-ink-500">
                {m}
              </th>
            ))}
            <th className="pl-2 text-2xs font-normal text-ink-500">Year</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const row = matrix.get(year)!;
            const yearTotal =
              [...row.values()].reduce((acc, r) => acc * (1 + r), 1) - 1;
            return (
              <tr key={year}>
                <td className="pr-1 font-mono text-2xs text-ink-400 tnum">{year}</td>
                {months.map((_, i) => {
                  const value = row.get(i + 1);
                  return (
                    <td key={i} className="p-0">
                      <div
                        title={value === undefined ? "" : `${monthLabel(`${year}-${String(i + 1).padStart(2, "0")}`)}: ${(value * 100).toFixed(2)}%`}
                        className="flex h-5 items-center justify-center rounded-sm font-mono text-[9px] tnum"
                        style={{
                          background:
                            value === undefined ? "rgba(255,255,255,0.03)" : divergingColor(value, scale),
                          color: value === undefined ? "transparent" : "#dfe4ea",
                        }}
                      >
                        {value === undefined ? "" : (value * 100).toFixed(0)}
                      </div>
                    </td>
                  );
                })}
                <td className="pl-2">
                  <span
                    className={cx(
                      "font-mono text-2xs tnum",
                      yearTotal >= 0 ? "text-acid-400" : "text-cherry-400",
                    )}
                  >
                    {`${yearTotal >= 0 ? "+" : ""}${(yearTotal * 100).toFixed(1)}%`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical bar chart for the convergence trace. */
export function ColumnChart({
  values,
  labels,
  color = "#6b8cff",
  height = 90,
  format = (v: number) => v.toFixed(2),
}: {
  values: number[];
  labels: string[];
  color?: string;
  height?: number;
  format?: (value: number) => string;
}) {
  const [lo, hi] = extent(values);
  const floor = Math.min(0, lo);
  const span = hi - floor || 1;
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="font-mono text-[9px] text-ink-500 opacity-0 transition-opacity group-hover:opacity-100 tnum">
            {format(v)}
          </span>
          <div
            className="w-full rounded-t-sm transition-colors"
            style={{
              height: `${Math.max(2, ((v - floor) / span) * (height - 22))}px`,
              background: color,
              opacity: 0.45 + 0.55 * (i / Math.max(1, values.length - 1)),
            }}
            title={`${labels[i]}: ${format(v)}`}
          />
          <span className="font-mono text-[9px] text-ink-600">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
