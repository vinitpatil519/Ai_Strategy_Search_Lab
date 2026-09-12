"use client";

import { useMemo } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { BarRow, ColumnChart, RegimeRibbon } from "@/components/charts/MiniCharts";
import { Button, EmptyState, Field, Panel, Stat, Tag, cx } from "@/components/ui/primitives";
import { FAMILY_BY_ID } from "@/lib/engine/families";
import type { SearchRun } from "@/lib/engine/types";
import { duration, int, num, pct, signed, signedPct } from "@/lib/format";
import { FAMILY_COLORS, REGIME_COLORS, clusterColor } from "@/lib/palette";
import { useLab } from "@/lib/store";
import { median, oosBands, resample } from "./regime-bands";

/** Landing view: what the run found, how it converged, and where the edge sits. */
export function OverviewPanel() {
  const run = useLab((s) => s.run);
  const status = useLab((s) => s.status);
  const startRun = useLab((s) => s.startRun);
  const progress = useLab((s) => s.progress);

  if (!run) {
    return (
      <Panel className="min-h-[420px]">
        <EmptyState
          title={status === "running" ? "Search in progress" : "No run yet"}
          body={
            status === "running"
              ? (progress?.message ?? "Evaluating strategies.")
              : "Configure the search in the left rail and run it. Everything is computed locally in a worker thread: price generation, genetic search, walk-forward validation, regime fitting and clustering."
          }
          action={
            status !== "running" ? (
              <Button variant="primary" onClick={() => void startRun()}>
                Run search
              </Button>
            ) : undefined
          }
        />
      </Panel>
    );
  }

  return <OverviewContent run={run} />;
}

function OverviewContent({ run }: { run: SearchRun }) {
  const setTab = useLab((s) => s.setTab);
  const select = useLab((s) => s.select);

  const best = run.survivors[0];
  const positive = run.survivors.filter((s) => s.outSample.sharpe > 0).length;
  const hitRate = run.survivors.length ? positive / run.survivors.length : 0;
  const medianOos = median(run.survivors.map((s) => s.outSample.sharpe));
  const medianIs = median(run.survivors.map((s) => s.inSample.sharpe));
  const decay = medianIs === 0 ? 0 : 1 - medianOos / medianIs;

  const topCurves = useMemo(() => run.survivors.slice(0, 5), [run]);
  const points = topCurves[0]?.equity.length ?? 0;
  const bands = useMemo(() => oosBands(run, points), [run, points]);

  const chartSeries = useMemo(() => {
    // Top survivors often share a family, so colour the curves by rank instead
    // of by family — otherwise five red lines sit on top of each other.
    const rankRamp = ["#35e0a1", "#6b8cff", "#ff9f6e", "#c77dff", "#4fd1c5"];
    const survivors = topCurves.map((s, i) => ({
      id: s.genome.id,
      label: `#${s.rank} ${FAMILY_BY_ID[s.genome.family].label} ${s.genome.symbol}`,
      values: s.equity,
      color: rankRamp[i % rankRamp.length],
      width: i === 0 ? 2 : 1.15,
    }));

    // The exported benchmark covers the whole scored window; take its tail so
    // the comparison starts where the held-out window starts.
    const scoredBars = run.split.total - 260;
    const oosBars = run.split.total - run.split.isEnd;
    const cut = Math.max(
      0,
      run.benchmark.equity.length - Math.round((oosBars / Math.max(1, scoredBars)) * run.benchmark.equity.length),
    );
    const tail = run.benchmark.equity.slice(cut);
    const base = tail[0] || 1;

    return [
      ...survivors,
      {
        id: "benchmark",
        label: "Equal-weight universe",
        values: resample(tail.map((v) => v / base), points),
        color: "#5c6878",
        width: 1.2,
        dashed: true,
      },
    ];
  }, [topCurves, run, points]);

  return (
    <div className="flex flex-col gap-3">
      <Panel bodyClassName="p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Evaluated"
            value={int(run.evaluated)}
            hint={`${run.generations.length} generations`}
          />
          <Stat
            label="Survivors"
            value={int(run.survivors.length)}
            hint={`${run.clusters.length} clusters`}
          />
          <Stat
            label="Best OOS Sharpe"
            value={num(best?.outSample.sharpe ?? 0)}
            tone={(best?.outSample.sharpe ?? 0) > 0 ? "good" : "bad"}
            hint={
              best ? `${FAMILY_BY_ID[best.genome.family].label} on ${best.genome.symbol}` : undefined
            }
          />
          <Stat
            label="Median OOS Sharpe"
            value={num(medianOos)}
            tone={medianOos > 0 ? "good" : "bad"}
            hint={`${pct(hitRate, 0)} above zero`}
          />
          <Stat
            label="IS to OOS decay"
            value={pct(decay, 0)}
            tone={decay < 0.35 ? "good" : decay < 0.7 ? "neutral" : "bad"}
            hint="Median Sharpe given back"
          />
          <Stat
            label="Run time"
            value={duration(run.finishedAt - run.startedAt)}
            hint={`seed ${run.config.seed}`}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.55fr_1fr]">
        <Panel
          title="Out-of-sample equity, top 5 survivors"
          subtitle={`Held out ${run.split.oosLabel} · regime shading behind the curves`}
          actions={
            <Button size="sm" variant="outline" onClick={() => setTab("leaderboard")}>
              Leaderboard
            </Button>
          }
        >
          <LineChart
            series={chartSeries}
            labels={topCurves[0]?.equityDates ?? []}
            height={286}
            baseline={1}
            yFormat={(v) => `${v.toFixed(2)}x`}
            bands={bands}
          />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Convergence" subtitle="Best fitness per generation">
            <ColumnChart
              values={run.generations.map((g) => g.best)}
              labels={run.generations.map((g) => String(g.generation))}
              color="#35e0a1"
              height={96}
            />
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-ink-700/60 pt-3">
              <Field label="First gen">{num(run.generations[0]?.best ?? 0)}</Field>
              <Field label="Final gen">
                {num(run.generations[run.generations.length - 1]?.best ?? 0)}
              </Field>
              <Field label="Diversity">
                {num(run.generations[run.generations.length - 1]?.diversity ?? 0)}
              </Field>
            </div>
          </Panel>

          <Panel title="Family performance" subtitle="Median out-of-sample Sharpe among survivors">
            <div className="divide-y divide-ink-700/40">
              {run.familyStats
                .slice()
                .sort((a, b) => b.medianSharpe - a.medianSharpe)
                .map((f) => (
                  <BarRow
                    key={f.family}
                    label={FAMILY_BY_ID[f.family].label}
                    value={f.medianSharpe}
                    max={Math.max(0.4, ...run.familyStats.map((x) => Math.abs(x.medianSharpe)))}
                    color={FAMILY_COLORS[f.family]}
                    display={signed(f.medianSharpe)}
                    sub={`${f.count} survivors · best ${num(f.bestSharpe)}`}
                  />
                ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel
          title="Regime timeline"
          subtitle={`${run.regimes.states.length} HMM states · ${run.regimes.segments.length} regime runs · ${run.regimes.iterations} EM iterations`}
          actions={
            <Button size="sm" variant="outline" onClick={() => setTab("regimes")}>
              Regime atlas
            </Button>
          }
        >
          <RegimeRibbon
            path={Array.from(run.regimes.path)}
            colors={run.regimes.states.map((s) => REGIME_COLORS[s.tone] ?? "#3a4454")}
            labels={run.regimes.states.map((s) => s.label)}
            dates={run.benchmark.dates}
            height={18}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {run.regimes.states.map((state) => (
              <div
                key={state.id}
                className="flex items-center justify-between gap-2 rounded border border-ink-700/60 bg-ink-850/60 px-2.5 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: REGIME_COLORS[state.tone] ?? "#3a4454" }}
                  />
                  <span className="truncate text-xs text-ink-200">{state.label}</span>
                </span>
                <span className="shrink-0 font-mono text-2xs text-ink-400 tnum">
                  {`${pct(state.share, 0)} · ${signedPct(state.meanReturn, 0)} · ${pct(state.vol, 0)} vol`}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Clusters"
          subtitle="Behavioural groups among survivors"
          actions={
            <Button size="sm" variant="outline" onClick={() => setTab("clusters")}>
              Cluster map
            </Button>
          }
        >
          {run.clusters.length === 0 ? (
            <p className="text-xs text-ink-400">Too few survivors to cluster.</p>
          ) : (
            <div className="divide-y divide-ink-700/40">
              {run.clusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => {
                    select(cluster.medoidId);
                    setTab("clusters");
                  }}
                  className="row-hover flex w-full items-center justify-between gap-3 px-1 py-2 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: clusterColor(cluster.id) }}
                    />
                    <span className="truncate text-xs text-ink-200">{cluster.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Tag>{`n=${cluster.size}`}</Tag>
                    <span
                      className={cx(
                        "font-mono text-2xs tnum",
                        cluster.centroidMetrics.sharpe > 0 ? "text-acid-400" : "text-cherry-400",
                      )}
                    >
                      {signed(cluster.centroidMetrics.sharpe)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
