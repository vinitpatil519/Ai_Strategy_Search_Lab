"use client";

import { useMemo } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { ScatterMap, type ScatterPoint } from "@/components/charts/ScatterMap";
import { Button, EmptyState, Field, Panel, Tag, cx } from "@/components/ui/primitives";
import { FAMILY_BY_ID } from "@/lib/engine/families";
import { genomeName } from "@/lib/engine/genome";
import type { SearchRun } from "@/lib/engine/types";
import { int, num, pct, signed } from "@/lib/format";
import { FAMILY_COLORS, clusterColor } from "@/lib/palette";
import { useLab } from "@/lib/store";

/**
 * Cluster explorer.
 *
 * The scatter is the t-SNE embedding of the survivor feature matrix — risk and
 * return metrics plus a coarse behavioural signature — so points that sit
 * together are strategies that behaved alike, not merely strategies that scored
 * alike. Selecting a cluster filters the member list and overlays their curves.
 */
export function ClusterPanel() {
  const run = useLab((s) => s.run);
  if (!run || run.clusters.length === 0) {
    return (
      <Panel className="min-h-[360px]">
        <EmptyState
          title="No cluster map yet"
          body="Run a search with enough survivors and the embedding appears here."
        />
      </Panel>
    );
  }
  return <ClusterContent run={run} />;
}

function ClusterContent({ run }: { run: SearchRun }) {
  const selectedId = useLab((s) => s.selectedId);
  const select = useLab((s) => s.select);
  const setTab = useLab((s) => s.setTab);
  const clusterFilter = useLab((s) => s.clusterFilter);
  const setClusterFilter = useLab((s) => s.setClusterFilter);

  const points = useMemo<ScatterPoint[]>(
    () =>
      run.survivors.map((s) => ({
        id: s.genome.id,
        x: s.embedding[0],
        y: s.embedding[1],
        weight: s.outSample.sharpe,
        color: clusterColor(s.cluster),
        label: genomeName(s.genome),
        family: s.genome.family,
        cluster: s.cluster,
        detail: [
          `OOS Sharpe ${num(s.outSample.sharpe)}`,
          `CAGR ${pct(s.outSample.cagr)} · DD ${pct(s.outSample.maxDrawdown)}`,
          `${int(s.outSample.trades)} trades · robust ${signed(s.robustness)}`,
        ],
      })),
    [run],
  );

  const clusterLabels = useMemo(
    () => Object.fromEntries(run.clusters.map((c) => [c.id, `C${c.id}`])),
    [run],
  );

  const members = useMemo(
    () =>
      run.survivors
        .filter((s) => clusterFilter === null || s.cluster === clusterFilter)
        .slice(0, 60),
    [run, clusterFilter],
  );

  const overlay = useMemo(() => {
    const picked = members.slice(0, 8);
    return picked.map((s) => ({
      id: s.genome.id,
      label: `#${s.rank} ${s.genome.symbol}`,
      values: s.equity,
      color: clusterColor(s.cluster),
      width: s.genome.id === selectedId ? 2 : 1,
    }));
  }, [members, selectedId]);

  const activeCluster = clusterFilter === null ? null : run.clusters.find((c) => c.id === clusterFilter);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="t-SNE map of survivors"
          subtitle="Marker size is out-of-sample Sharpe · colour is cluster · click to inspect"
          actions={
            clusterFilter !== null ? (
              <Button size="sm" variant="outline" onClick={() => setClusterFilter(null)}>
                Clear focus
              </Button>
            ) : undefined
          }
        >
          <ScatterMap
            points={points}
            height={392}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
            highlightCluster={clusterFilter}
            clusterLabels={clusterLabels}
          />
        </Panel>

        <Panel
          title="Clusters"
          subtitle={`${run.clusters.length} groups from k-means on the standardized feature matrix`}
          bodyClassName="p-2"
        >
          <div className="flex flex-col gap-1.5">
            {run.clusters.map((cluster) => {
              const active = clusterFilter === cluster.id;
              return (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => setClusterFilter(active ? null : cluster.id)}
                  className={cx(
                    "rounded-md border px-3 py-2.5 text-left transition-colors duration-100",
                    active
                      ? "border-ink-500 bg-ink-800"
                      : "border-ink-700/70 hover:border-ink-600 hover:bg-ink-850",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: clusterColor(cluster.id) }}
                      />
                      <span className="truncate text-xs text-ink-100">{cluster.label}</span>
                    </span>
                    <Tag>{`n=${cluster.size}`}</Tag>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <MiniMetric label="Sharpe" value={num(cluster.centroidMetrics.sharpe)} good={cluster.centroidMetrics.sharpe > 0} />
                    <MiniMetric label="CAGR" value={pct(cluster.centroidMetrics.cagr, 0)} good={cluster.centroidMetrics.cagr > 0} />
                    <MiniMetric label="Max DD" value={pct(cluster.centroidMetrics.maxDrawdown, 0)} />
                    <MiniMetric label="Vol" value={pct(cluster.centroidMetrics.vol, 0)} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(cluster.familyMix)
                      .sort((a, b) => b[1] - a[1])
                      .map(([family, count]) => (
                        <Tag key={family} color={FAMILY_COLORS[family as keyof typeof FAMILY_COLORS]}>
                          {`${FAMILY_BY_ID[family as keyof typeof FAMILY_BY_ID].label} ${count}`}
                        </Tag>
                      ))}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.2fr]">
        <Panel
          title={activeCluster ? `Cluster ${activeCluster.id} members` : "All survivors"}
          subtitle={`${members.length} shown · double-click for the full strategy view`}
          bodyClassName="p-0"
        >
          <div className="max-h-[330px] overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {members.map((s) => (
                  <tr
                    key={s.genome.id}
                    onClick={() => select(s.genome.id)}
                    onDoubleClick={() => {
                      select(s.genome.id);
                      setTab("strategy");
                    }}
                    className={cx(
                      "cursor-pointer border-b border-ink-800/70",
                      s.genome.id === selectedId ? "bg-ink-800" : "hover:bg-ink-850/70",
                    )}
                  >
                    <td className="w-8 px-3 py-1.5 font-mono text-2xs text-ink-500 tnum">{s.rank}</td>
                    <td className="px-1 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-0.5 rounded-full"
                          style={{ background: FAMILY_COLORS[s.genome.family] }}
                        />
                        <span className="text-ink-200">{FAMILY_BY_ID[s.genome.family].label}</span>
                        <span className="font-mono text-2xs text-ink-500">{s.genome.symbol}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-2xs tnum">
                      <span className={s.outSample.sharpe > 0 ? "text-acid-400" : "text-cherry-400"}>
                        {num(s.outSample.sharpe)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-2xs text-ink-300 tnum">
                      {pct(s.outSample.cagr, 0)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-2xs text-cherry-400/80 tnum">
                      {pct(s.outSample.maxDrawdown, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Member equity overlay"
          subtitle="Out-of-sample curves for the first eight members"
        >
          {overlay.length === 0 ? (
            <p className="text-xs text-ink-500">Nothing to draw.</p>
          ) : (
            <LineChart
              series={overlay}
              labels={members[0]?.equityDates ?? []}
              height={286}
              baseline={1}
              yFormat={(v) => `${v.toFixed(2)}x`}
              showLegend={false}
            />
          )}
          {activeCluster && (
            <div className="mt-3 grid grid-cols-2 gap-x-6 border-t border-ink-700/60 pt-2">
              <Field label="Representative">{genomeName(
                run.survivors.find((s) => s.genome.id === activeCluster.medoidId)?.genome ??
                  run.survivors[0].genome,
              )}</Field>
              <Field label="Cluster size">{int(activeCluster.size)}</Field>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-ink-600">{label}</div>
      <div
        className={cx(
          "font-mono text-2xs tnum",
          good === undefined ? "text-ink-200" : good ? "text-acid-400" : "text-cherry-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}
