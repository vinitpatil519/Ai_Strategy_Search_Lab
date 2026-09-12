"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";
import {
  areaPath,
  extent,
  linePath,
  linear,
  mergedExtent,
  nearestIndex,
  niceTicks,
  pad,
} from "./scale";

export interface LineSeries {
  id: string;
  label: string;
  values: number[];
  color: string;
  width?: number;
  dashed?: boolean;
  /** Fill under the line, used for the primary series only. */
  fill?: boolean;
  /** Draw on a second axis, scaled independently. */
  axis?: "left" | "right";
}

export interface Band {
  from: number;
  to: number;
  color: string;
  label?: string;
}

/**
 * Multi-series line chart with a shared crosshair.
 *
 * Handles the three things the lab needs everywhere: optional regime bands
 * behind the plot, a marker for the in-sample / out-of-sample boundary, and a
 * hover readout that reports every series at the same index.
 */
export function LineChart({
  series,
  labels,
  height = 260,
  bands,
  splitIndex,
  splitLabel,
  yFormat = (v) => v.toFixed(2),
  rightFormat,
  baseline,
  logScale = false,
  className,
  showLegend = true,
  tickCount = 5,
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  bands?: Band[];
  splitIndex?: number;
  splitLabel?: string;
  yFormat?: (value: number) => string;
  rightFormat?: (value: number) => string;
  baseline?: number;
  logScale?: boolean;
  className?: string;
  showLegend?: boolean;
  tickCount?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Render at the container's real pixel width. Stretching a fixed viewBox
  // would scale the axis labels non-uniformly and smear the type.
  const [width, setWidth] = useState(1000);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.max(320, Math.round(entries[0].contentRect.width));
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const margin = { top: 10, right: series.some((s) => s.axis === "right") ? 46 : 14, bottom: 22, left: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const count = series[0]?.values.length ?? 0;

  const resolvedTicks = Math.max(3, Math.min(tickCount, Math.floor(plotH / 34)));

  const { yLeft, yRight, leftTicks, rightTicks } = useMemo(() => {
    const leftSeries = series.filter((s) => s.axis !== "right");
    const rightSeries = series.filter((s) => s.axis === "right");
    const transform = (v: number) => (logScale ? Math.log(Math.max(1e-6, v)) : v);

    const leftDomainRaw = leftSeries.length
      ? mergedExtent(leftSeries.map((s) => s.values.map(transform)))
      : ([0, 1] as [number, number]);
    const leftDomain = pad(leftDomainRaw, 0.08);
    const yl = linear(leftDomain, [margin.top + plotH, margin.top]);

    const rightDomain = rightSeries.length
      ? pad(mergedExtent(rightSeries.map((s) => s.values)), 0.12)
      : ([0, 1] as [number, number]);
    const yr = linear(rightDomain, [margin.top + plotH, margin.top]);

    return {
      yLeft: yl,
      yRight: yr,
      leftTicks: niceTicks(leftDomain[0], leftDomain[1], resolvedTicks),
      rightTicks: rightSeries.length ? niceTicks(rightDomain[0], rightDomain[1], 4) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, logScale, plotH, resolvedTicks, margin.top]);

  const x = (index: number) =>
    margin.left + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW);

  const mapValue = (v: number) => (logScale ? Math.log(Math.max(1e-6, v)) : v);

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    setHover(nearestIndex(px, count, margin.left, margin.left + plotW));
  };

  const hoverX = hover === null ? 0 : x(hover);
  const tooltipRight = hoverX > margin.left + plotW * 0.62;

  return (
    <div ref={boxRef} className={cx("relative w-full", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* regime bands */}
        {bands?.map((band, i) => (
          <rect
            key={`${band.from}-${band.to}-${i}`}
            x={x(band.from)}
            y={margin.top}
            width={Math.max(0.6, x(band.to) - x(band.from))}
            height={plotH}
            fill={band.color}
          />
        ))}

        {/* horizontal gridlines */}
        {leftTicks.map((tick) => (
          <g key={`t${tick}`}>
            <line
              x1={margin.left}
              x2={margin.left + plotW}
              y1={yLeft(tick)}
              y2={yLeft(tick)}
              stroke="rgba(255,255,255,0.055)"
              strokeWidth={1}
            />
            <text
              x={margin.left - 7}
              y={yLeft(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-500 font-mono"
              fontSize={9.5}
            >
              {yFormat(logScale ? Math.exp(tick) : tick)}
            </text>
          </g>
        ))}

        {rightTicks.map((tick) => (
          <text
            key={`r${tick}`}
            x={margin.left + plotW + 7}
            y={yRight(tick)}
            textAnchor="start"
            dominantBaseline="middle"
            className="fill-ink-600 font-mono"
            fontSize={9.5}
          >
            {(rightFormat ?? yFormat)(tick)}
          </text>
        ))}

        {baseline !== undefined && (
          <line
            x1={margin.left}
            x2={margin.left + plotW}
            y1={yLeft(mapValue(baseline))}
            y2={yLeft(mapValue(baseline))}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
        )}

        {/* x labels: first, split, last */}
        {count > 1 &&
          xLabelIndices(count, plotW).map((index) => (
            <text
              key={`x${index}`}
              x={x(index)}
              y={height - 6}
              textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
              className="fill-ink-600 font-mono"
              fontSize={9.5}
            >
              {labels[index] ?? ""}
            </text>
          ))}

        {splitIndex !== undefined && splitIndex > 0 && splitIndex < count - 1 && (
          <g>
            <line
              x1={x(splitIndex)}
              x2={x(splitIndex)}
              y1={margin.top}
              y2={margin.top + plotH}
              stroke="rgba(155,180,255,0.5)"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            {splitLabel && (
              <text
                x={x(splitIndex) + 5}
                y={margin.top + 10}
                className="fill-iris-400 font-mono"
                fontSize={9}
              >
                {splitLabel}
              </text>
            )}
          </g>
        )}

        {/* series */}
        {series.map((s) => {
          const scale = s.axis === "right" ? yRight : yLeft;
          const values = s.axis === "right" ? s.values : s.values.map(mapValue);
          return (
            <g key={s.id}>
              {s.fill && (
                <path
                  d={areaPath(
                    values,
                    x,
                    scale,
                    s.axis === "right" ? 0 : mapValue(baseline ?? extent(values)[0]),
                  )}
                  fill={s.color}
                  opacity={0.1}
                />
              )}
              <path
                d={linePath(values, x, scale)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 1.5}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hover !== null && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={margin.top}
              y2={margin.top + plotH}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth={1}
            />
            {series.map((s) => {
              const v = s.values[hover];
              if (!Number.isFinite(v)) return null;
              const scale = s.axis === "right" ? yRight : yLeft;
              const py = scale(s.axis === "right" ? v : mapValue(v));
              return (
                <circle
                  key={`h${s.id}`}
                  cx={hoverX}
                  cy={py}
                  r={2.8}
                  fill="#08090b"
                  stroke={s.color}
                  strokeWidth={1.6}
                />
              );
            })}
          </g>
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[128px] rounded-md border border-ink-600 bg-ink-900/95 px-2 py-1.5 shadow-lg"
          style={tooltipRight ? { left: 52 } : { right: 12 }}
        >
          <div className="font-mono text-2xs text-ink-400">{labels[hover] ?? ""}</div>
          <div className="mt-1 space-y-0.5">
            {series.map((s) => (
              <div key={`tt${s.id}`} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-2xs text-ink-300">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </span>
                <span className="font-mono text-2xs text-ink-100 tnum">
                  {Number.isFinite(s.values[hover])
                    ? (s.axis === "right" ? (rightFormat ?? yFormat) : yFormat)(s.values[hover])
                    : "–"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showLegend && series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={`l${s.id}`} className="flex items-center gap-1.5 text-2xs text-ink-400">
              <span
                className="inline-block h-0.5 w-3.5 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pick first, last and a few evenly spaced dates, scaled to the space there is. */
function xLabelIndices(count: number, plotWidth: number): number[] {
  const slots = Math.max(2, Math.min(5, Math.floor(plotWidth / 150)));
  if (slots <= 2) return [0, count - 1];
  const out: number[] = [];
  for (let i = 0; i < slots; i++) out.push(Math.round((i / (slots - 1)) * (count - 1)));
  return [...new Set(out)];
}
