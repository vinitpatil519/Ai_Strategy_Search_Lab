"use client";

import { useState } from "react";
import { cx } from "@/components/ui/primitives";
import { divergingColor, heatTextColor } from "@/lib/palette";

export interface HeatmapCell {
  value: number;
  /** Extra context shown on hover, e.g. exposure inside the regime. */
  detail?: string;
}

/**
 * Matrix heatmap with a diverging scale.
 *
 * Used for the regime atlas (strategies against detected regimes) and for
 * family-level summaries. Row labels stay sticky so a long survivor list can be
 * scanned without losing track of which strategy a row belongs to.
 */
export function Heatmap({
  rows,
  columns,
  cells,
  scale = 1.5,
  cellHeight = 26,
  rowWidth = 210,
  format = (v) => v.toFixed(2),
  onRowClick,
  activeRow,
  rowMeta,
}: {
  rows: string[];
  columns: string[];
  cells: HeatmapCell[][];
  scale?: number;
  cellHeight?: number;
  rowWidth?: number;
  format?: (value: number) => string;
  onRowClick?: (index: number) => void;
  activeRow?: number;
  rowMeta?: (index: number) => React.ReactNode;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  return (
    <div className="min-w-0 overflow-auto">
      <div className="min-w-max">
        <div className="flex items-end gap-px pb-1" style={{ paddingLeft: rowWidth }}>
          {columns.map((column) => (
            <div
              key={column}
              className="flex-1 px-1 text-center text-2xs leading-tight text-ink-400"
              style={{ minWidth: 92 }}
            >
              {column}
            </div>
          ))}
        </div>

        {rows.map((row, r) => (
          <div
            key={`${row}-${r}`}
            className={cx(
              "flex items-stretch gap-px",
              onRowClick && "cursor-pointer",
              activeRow === r && "bg-ink-800/60",
            )}
            onClick={() => onRowClick?.(r)}
          >
            <div
              className="sticky left-0 z-10 flex items-center gap-2 bg-ink-900/95 pr-3 text-2xs"
              style={{ width: rowWidth, height: cellHeight }}
            >
              <span className="truncate text-ink-200">{row}</span>
              {rowMeta?.(r)}
            </div>
            {cells[r]?.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                className="relative flex flex-1 items-center justify-center font-mono text-2xs tnum transition-transform duration-100"
                style={{
                  minWidth: 92,
                  height: cellHeight,
                  background: divergingColor(cell.value, scale),
                  color: heatTextColor(cell.value, scale),
                  outline: hover && hover.r === r && hover.c === c ? "1px solid rgba(255,255,255,0.5)" : "none",
                }}
                onMouseEnter={() => setHover({ r, c })}
                onMouseLeave={() => setHover(null)}
                title={cell.detail}
              >
                {format(cell.value)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeatScaleLegend({
  scale = 1.5,
  lowLabel,
  highLabel,
}: {
  scale?: number;
  lowLabel?: string;
  highLabel?: string;
}) {
  const steps = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-ink-500">{lowLabel ?? `-${scale.toFixed(1)}`}</span>
      <div className="flex h-2 overflow-hidden rounded-full">
        {steps.map((s) => (
          <span
            key={s}
            className="h-full w-4"
            style={{ background: divergingColor(s * scale, scale) }}
          />
        ))}
      </div>
      <span className="text-2xs text-ink-500">{highLabel ?? `+${scale.toFixed(1)}`}</span>
    </div>
  );
}
