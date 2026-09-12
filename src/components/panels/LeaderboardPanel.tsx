"use client";

import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts/MiniCharts";
import { Button, EmptyState, Panel, Segmented, Tag, cx } from "@/components/ui/primitives";
import { FAMILIES, FAMILY_BY_ID } from "@/lib/engine/families";
import { genomeName } from "@/lib/engine/genome";
import type { EvaluatedStrategy } from "@/lib/engine/types";
import { int, num, pct, signed } from "@/lib/format";
import { FAMILY_COLORS, clusterColor } from "@/lib/palette";
import { useLab } from "@/lib/store";

type SortKey =
  | "rank"
  | "oosSharpe"
  | "isSharpe"
  | "cagr"
  | "maxDrawdown"
  | "calmar"
  | "trades"
  | "robustness"
  | "turnover";

const COLUMNS: { key: SortKey; label: string; align?: "left" | "right"; title?: string }[] = [
  { key: "rank", label: "#", align: "left" },
  { key: "isSharpe", label: "IS Sharpe", align: "right", title: "Sharpe on the window the search optimized" },
  { key: "oosSharpe", label: "OOS Sharpe", align: "right", title: "Sharpe on the held-out window" },
  { key: "cagr", label: "CAGR", align: "right" },
  { key: "maxDrawdown", label: "Max DD", align: "right" },
  { key: "calmar", label: "Calmar", align: "right" },
  { key: "robustness", label: "Robust", align: "right", title: "Walk-forward consistency, -1 to 1" },
  { key: "trades", label: "Trades", align: "right" },
  { key: "turnover", label: "Turnover", align: "right", title: "Annualized gross exposure traded" },
];

function valueOf(row: EvaluatedStrategy, key: SortKey): number {
  switch (key) {
    case "rank":
      return -row.rank;
    case "oosSharpe":
      return row.outSample.sharpe;
    case "isSharpe":
      return row.inSample.sharpe;
    case "cagr":
      return row.outSample.cagr;
    case "maxDrawdown":
      return row.outSample.maxDrawdown;
    case "calmar":
      return row.outSample.calmar;
    case "trades":
      return row.outSample.trades;
    case "robustness":
      return row.robustness;
    case "turnover":
      return row.outSample.turnover;
  }
}

/** Ranked survivor table. Sorting, filtering and selection all live here; the
 *  detail view reacts to the selection. */
export function LeaderboardPanel() {
  const run = useLab((s) => s.run);
  const selectedId = useLab((s) => s.selectedId);
  const select = useLab((s) => s.select);
  const setTab = useLab((s) => s.setTab);
  const familyFilter = useLab((s) => s.familyFilter);
  const setFamilyFilter = useLab((s) => s.setFamilyFilter);
  const clusterFilter = useLab((s) => s.clusterFilter);
  const setClusterFilter = useLab((s) => s.setClusterFilter);
  const setEditorGenome = useLab((s) => s.setEditorGenome);

  const [sort, setSort] = useState<SortKey>("rank");
  const [onlyPositive, setOnlyPositive] = useState<"all" | "positive">("all");

  const rows = useMemo(() => {
    const source = run?.survivors ?? [];
    const filtered = source.filter(
      (r) =>
        (familyFilter === null || r.genome.family === familyFilter) &&
        (clusterFilter === null || r.cluster === clusterFilter) &&
        (onlyPositive === "all" || r.outSample.sharpe > 0),
    );
    return filtered.sort((a, b) => valueOf(b, sort) - valueOf(a, sort));
  }, [run, familyFilter, clusterFilter, onlyPositive, sort]);

  if (!run) {
    return (
      <Panel className="min-h-[360px]">
        <EmptyState title="Nothing to rank yet" body="Run a search to populate the leaderboard." />
      </Panel>
    );
  }

  return (
    <Panel
      title="Survivor leaderboard"
      subtitle={`${rows.length} of ${run.survivors.length} survivors · sorted by ${COLUMNS.find((c) => c.key === sort)?.label}`}
      bodyClassName="p-0"
      actions={
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            options={[
              { value: "all", label: "All" },
              { value: "positive", label: "OOS > 0" },
            ]}
            value={onlyPositive}
            onChange={setOnlyPositive}
          />
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-700/60 px-4 py-2.5">
        <span className="label mr-1">Family</span>
        <FilterChip active={familyFilter === null} onClick={() => setFamilyFilter(null)}>
          All
        </FilterChip>
        {FAMILIES.map((family) => (
          <FilterChip
            key={family.id}
            active={familyFilter === family.id}
            color={FAMILY_COLORS[family.id]}
            onClick={() => setFamilyFilter(familyFilter === family.id ? null : family.id)}
          >
            {family.label}
          </FilterChip>
        ))}
        {run.clusters.length > 0 && (
          <>
            <span className="label ml-3 mr-1">Cluster</span>
            <FilterChip active={clusterFilter === null} onClick={() => setClusterFilter(null)}>
              All
            </FilterChip>
            {run.clusters.map((cluster) => (
              <FilterChip
                key={cluster.id}
                active={clusterFilter === cluster.id}
                color={clusterColor(cluster.id)}
                onClick={() => setClusterFilter(clusterFilter === cluster.id ? null : cluster.id)}
              >
                {`C${cluster.id} (${cluster.size})`}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      {/* Fixed viewport height with a sticky header: a 140-row survivor list
          should scroll inside the panel, not stretch the page to five screens. */}
      <div className="max-h-[calc(100vh-17rem)] min-h-[320px] overflow-auto">
        <table className="w-full min-w-[1040px] border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-ink-900">
            <tr className="border-b border-ink-700/60 text-ink-500">
              <th className="px-4 py-2 text-left font-normal">Strategy</th>
              {COLUMNS.filter((c) => c.key !== "rank").map((column) => (
                <th
                  key={column.key}
                  title={column.title}
                  className="whitespace-nowrap px-3 py-2 text-right font-normal"
                >
                  <button
                    type="button"
                    onClick={() => setSort(column.key)}
                    className={cx(
                      "transition-colors hover:text-ink-200",
                      sort === column.key && "text-ink-100",
                    )}
                  >
                    {column.label}
                    {sort === column.key && <span className="ml-1 text-acid-500">▾</span>}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-normal">OOS curve</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = row.genome.id === selectedId;
              return (
                <tr
                  key={row.genome.id}
                  onClick={() => select(row.genome.id)}
                  onDoubleClick={() => {
                    select(row.genome.id);
                    setTab("strategy");
                  }}
                  className={cx(
                    "cursor-pointer border-b border-ink-800/70 transition-colors",
                    active ? "bg-ink-800" : "hover:bg-ink-850/70",
                  )}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-2xs text-ink-500 tnum">
                        {row.rank}
                      </span>
                      <span
                        className="h-4 w-0.5 shrink-0 rounded-full"
                        style={{ background: FAMILY_COLORS[row.genome.family] }}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-ink-100">
                          {FAMILY_BY_ID[row.genome.family].label}
                          <span className="ml-1.5 font-mono text-2xs text-ink-400">
                            {row.genome.symbol}
                          </span>
                        </div>
                        <div className="truncate font-mono text-[10px] text-ink-600">
                          {genomeName(row.genome)}
                        </div>
                      </div>
                      {run.clusters.length > 0 && (
                        <Tag color={clusterColor(row.cluster)} className="ml-1 shrink-0">
                          {`C${row.cluster}`}
                        </Tag>
                      )}
                    </div>
                  </td>
                  <Cell value={num(row.inSample.sharpe)} tone={row.inSample.sharpe > 0 ? "good" : "bad"} />
                  <Cell
                    value={num(row.outSample.sharpe)}
                    tone={row.outSample.sharpe > 0 ? "good" : "bad"}
                    strong
                  />
                  <Cell value={pct(row.outSample.cagr)} tone={row.outSample.cagr > 0 ? "good" : "bad"} />
                  <Cell value={pct(row.outSample.maxDrawdown)} tone="bad" />
                  <Cell value={num(row.outSample.calmar)} />
                  <Cell value={signed(row.robustness)} tone={row.robustness > 0 ? "good" : "bad"} />
                  <Cell value={int(row.outSample.trades)} />
                  <Cell value={num(row.outSample.turnover, 1)} />
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-2">
                      <Sparkline
                        values={row.equity}
                        color={row.outSample.sharpe > 0 ? "#35e0a1" : "#f4506c"}
                        baseline={1}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditorGenome(row.genome);
                          setTab("editor");
                        }}
                        title="Open in the strategy editor"
                      >
                        Edit
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-xs text-ink-500">
                  No survivors match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Cell({
  value,
  tone,
  strong,
}: {
  value: string;
  tone?: "good" | "bad";
  strong?: boolean;
}) {
  return (
    <td
      className={cx(
        "whitespace-nowrap px-3 py-2 text-right font-mono tnum",
        strong && "font-medium",
        tone === "good" ? "text-acid-400" : tone === "bad" ? "text-cherry-400" : "text-ink-200",
      )}
    >
      {value}
    </td>
  );
}

function FilterChip({
  children,
  active,
  color,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-2xs transition-colors duration-100",
        active
          ? "border-ink-500 bg-ink-750 text-ink-100"
          : "border-ink-700/70 text-ink-500 hover:border-ink-600 hover:text-ink-300",
      )}
    >
      {color && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: active ? color : "#3a4454" }}
        />
      )}
      {children}
    </button>
  );
}
