"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { extent, linear, pad } from "./scale";

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  /** Marker radius driver, typically out-of-sample Sharpe. */
  weight: number;
  color: string;
  label: string;
  detail: string[];
  family: string;
  cluster: number;
}

/**
 * Cluster map.
 *
 * Renders the t-SNE embedding of the survivor set. Marker area encodes the
 * ranking metric so the strong members of each cluster are visible without
 * hovering, and cluster hulls are approximated by a soft radial blur behind the
 * points rather than a computed polygon — cheaper, and it reads better at this
 * density.
 */
export function ScatterMap({
  points,
  height = 420,
  selectedId,
  onSelect,
  highlightCluster,
  clusterLabels,
}: {
  points: ScatterPoint[];
  height?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  highlightCluster?: number | null;
  clusterLabels?: Record<number, string>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [width, setWidth] = useState(900);
  const margin = 26;

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

  const { x, y, blobs } = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xScale = linear(pad(extent(xs), 0.1), [margin, width - margin]);
    const yScale = linear(pad(extent(ys), 0.1), [height - margin, margin]);

    // One soft blob per cluster, centred on its members' centroid.
    const byCluster = new Map<number, ScatterPoint[]>();
    for (const p of points) {
      if (!byCluster.has(p.cluster)) byCluster.set(p.cluster, []);
      byCluster.get(p.cluster)!.push(p);
    }
    const blobList = [...byCluster.entries()].map(([cluster, members]) => {
      const cx = members.reduce((a, m) => a + xScale(m.x), 0) / members.length;
      const cy = members.reduce((a, m) => a + yScale(m.y), 0) / members.length;
      const spread =
        Math.sqrt(
          members.reduce(
            (a, m) => a + (xScale(m.x) - cx) ** 2 + (yScale(m.y) - cy) ** 2,
            0,
          ) / members.length,
        ) || 20;
      return { cluster, cx, cy, r: Math.min(240, Math.max(34, spread * 1.5)), color: members[0].color };
    });

    return { x: xScale, y: yScale, blobs: blobList };
  }, [points, height, width]);

  const radius = (weight: number) => {
    const w = Math.max(-2, Math.min(3, weight));
    return 3.4 + ((w + 2) / 5) * 7.4;
  };

  const hovered = points.find((p) => p.id === hover) ?? null;

  return (
    <div ref={boxRef} className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <radialGradient id="blobFade">
            <stop offset="0%" stopColor="white" stopOpacity={0.13} />
            <stop offset="70%" stopColor="white" stopOpacity={0.04} />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>
        </defs>

        {blobs.map((b) => (
          <g key={`b${b.cluster}`}>
            <circle
              cx={b.cx}
              cy={b.cy}
              r={b.r}
              fill={b.color}
              opacity={highlightCluster === null || highlightCluster === undefined || highlightCluster === b.cluster ? 0.07 : 0.02}
            />
            {clusterLabels?.[b.cluster] && (
              <text
                x={b.cx}
                y={b.cy - b.r - 6}
                textAnchor="middle"
                fontSize={10}
                fill={b.color}
                opacity={0.75}
              >
                {clusterLabels[b.cluster]}
              </text>
            )}
          </g>
        ))}

        {points.map((p) => {
          const dim =
            highlightCluster !== null && highlightCluster !== undefined && p.cluster !== highlightCluster;
          const isSelected = p.id === selectedId;
          return (
            <circle
              key={p.id}
              cx={x(p.x)}
              cy={y(p.y)}
              r={radius(p.weight) * (isSelected ? 1.35 : 1)}
              fill={p.color}
              fillOpacity={dim ? 0.16 : isSelected ? 0.95 : 0.66}
              stroke={isSelected ? "#dfe4ea" : p.color}
              strokeWidth={isSelected ? 1.6 : 0.8}
              strokeOpacity={dim ? 0.2 : 1}
              className="cursor-pointer transition-[r,fill-opacity] duration-100"
              onMouseEnter={() => setHover(p.id)}
              onClick={() => onSelect?.(p.id)}
            />
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-52 rounded-md border border-ink-600 bg-ink-900/96 p-2 shadow-xl"
          style={{
            left: `calc(${((x(hovered.x) / width) * 100).toFixed(2)}% + 12px)`,
            top: `calc(${((y(hovered.y) / height) * 100).toFixed(2)}% - 8px)`,
            transform: x(hovered.x) > width * 0.7 ? "translateX(-108%)" : undefined,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: hovered.color }}
            />
            <span className="truncate font-mono text-2xs text-ink-100">{hovered.label}</span>
          </div>
          <dl className="mt-1.5 space-y-0.5">
            {hovered.detail.map((line) => (
              <dd key={line} className="font-mono text-2xs text-ink-400">
                {line}
              </dd>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
