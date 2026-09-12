"use client";

import { useMemo, useState } from "react";
import { HeatScaleLegend, Heatmap, type HeatmapCell } from "@/components/charts/Heatmap";
import { LineChart } from "@/components/charts/LineChart";
import { RegimeRibbon } from "@/components/charts/MiniCharts";
import { EmptyState, Panel, Segmented, Stat, Tag, cx } from "@/components/ui/primitives";
import { FAMILIES, FAMILY_BY_ID } from "@/lib/engine/families";
import type { FamilyId, SearchRun } from "@/lib/engine/types";
import { num, pct, signedPct } from "@/lib/format";
import { FAMILY_COLORS, REGIME_COLORS } from "@/lib/palette";
import { useLab } from "@/lib/store";
import { median, scoredBands } from "./regime-bands";

type View = "strategies" | "families";

/**
 * Regime atlas.
 *
 * The HMM labels every bar with a hidden state; each survivor is then scored
 * inside each state separately. Reading a row tells you when a strategy earns
 * its Sharpe, reading a column tells you which families a regime rewards — which
 * is the difference between a strategy that works and a strategy that is simply
 * long the dominant regime of the sample.
 */
export function RegimePanel() {
  const run = useLab((s) => s.run);
  if (!run) {
    return (
      <Panel className="min-h-[360px]">
        <EmptyState title="No regimes fitted" body="Run a search to fit the regime model." />
      </Panel>
    );
  }
  return <RegimeContent run={run} />;
}

function RegimeContent({ run }: { run: SearchRun }) {
  const [view, setView] = useState<View>("strategies");
  const selectedId = useLab((s) => s.selectedId);
  const select = useLab((s) => s.select);

  const regimeLabels = run.regimes.states.map((s) => s.label);
  const rowsShown = useMemo(() => run.survivors.slice(0, 28), [run]);

  const strategyCells: HeatmapCell[][] = useMemo(
    () =>
      rowsShown.map((s) =>
        s.regimeSharpe.map((value, r) => ({
          value,
          detail: `${regimeLabels[r]} · Sharpe ${num(value)} · exposure ${pct(s.regimeExposure[r] ?? 0, 0)}`,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsShown],
  );

  const familyCells: HeatmapCell[][] = useMemo(() => {
    const families = FAMILIES.map((f) => f.id).filter((id) =>
      run.survivors.some((s) => s.genome.family === id),
    );
    return families.map((family) => {
      const members = run.survivors.filter((s) => s.genome.family === family);
      return run.regimes.states.map((_, r) => ({
        value: median(members.map((m) => m.regimeSharpe[r] ?? 0)),
        detail: `${FAMILY_BY_ID[family].label} · ${members.length} survivors · median Sharpe in ${regimeLabels[r]}`,
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const familyRows = useMemo(
    () =>
      FAMILIES.map((f) => f.id)
        .filter((id) => run.survivors.some((s) => s.genome.family === id))
        .map((id) => FAMILY_BY_ID[id].label),
    [run],
  );

  const benchmarkBands = useMemo(
    () => scoredBands(run, run.benchmark.equity.length, 0.1),
    [run],
  );

  const dominant = run.regimes.states.reduce(
    (best, state) => (state.share > best.share ? state : best),
    run.regimes.states[0],
  );
  const worst = run.regimes.states.reduce(
    (bad, state) => (state.meanReturn < bad.meanReturn ? state : bad),
    run.regimes.states[0],
  );

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Benchmark with fitted regimes"
        subtitle={`Equal-weight universe · ${run.regimes.states.length} states · log likelihood ${num(run.regimes.logLikelihood, 0)}`}
      >
        <LineChart
          series={[
            {
              id: "bench",
              label: "Equal-weight universe",
              values: run.benchmark.equity,
              color: "#dfe4ea",
              width: 1.4,
            },
          ]}
          labels={run.benchmark.dates}
          height={220}
          bands={benchmarkBands}
          baseline={1}
          logScale
          yFormat={(v) => `${v.toFixed(2)}x`}
          showLegend={false}
        />
        <div className="mt-3">
          <RegimeRibbon
            path={Array.from(run.regimes.path)}
            colors={run.regimes.states.map((s) => REGIME_COLORS[s.tone] ?? "#3a4454")}
            labels={regimeLabels}
            dates={run.benchmark.dates}
            height={14}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {run.regimes.states.map((state) => (
            <span
              key={state.id}
              className="flex items-center gap-1.5 rounded border border-ink-700/60 px-2 py-1"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: REGIME_COLORS[state.tone] ?? "#3a4454" }}
              />
              <span className="text-2xs text-ink-200">{state.label}</span>
              <span className="font-mono text-2xs text-ink-500 tnum">{pct(state.share, 0)}</span>
            </span>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_2fr]">
        <Panel title="Regime statistics" bodyClassName="p-0">
          <div className="divide-y divide-ink-700/50">
            {run.regimes.states.map((state) => (
              <div key={state.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: REGIME_COLORS[state.tone] ?? "#3a4454" }}
                    />
                    <span className="text-xs text-ink-100">{state.label}</span>
                  </span>
                  <Tag>{state.tone}</Tag>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <Stat label="Share" value={pct(state.share, 0)} mono />
                  <Stat
                    label="Drift"
                    value={signedPct(state.meanReturn, 0)}
                    tone={state.meanReturn > 0 ? "good" : "bad"}
                  />
                  <Stat label="Vol" value={pct(state.vol, 0)} />
                  <Stat label="Avg run" value={`${state.avgLength.toFixed(0)}d`} />
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-ink-700/60 px-4 py-3">
            <p className="text-2xs leading-relaxed text-ink-400">
              {`The sample is dominated by ${dominant.label} at ${pct(dominant.share, 0)} of bars. The hardest state is ${worst.label}, drifting ${signedPct(worst.meanReturn, 0)} annualized at ${pct(worst.vol, 0)} volatility — a strategy that holds Sharpe there is carrying real diversification.`}
            </p>
          </div>
        </Panel>

        <Panel
          title="Regime atlas"
          subtitle={
            view === "strategies"
              ? "Sharpe per regime, top 28 survivors · click a row to select"
              : "Median Sharpe per regime by family"
          }
          actions={
            <div className="flex items-center gap-3">
              <HeatScaleLegend scale={1.5} lowLabel="-1.5" highLabel="+1.5" />
              <Segmented
                size="sm"
                options={[
                  { value: "strategies", label: "Strategies" },
                  { value: "families", label: "Families" },
                ]}
                value={view}
                onChange={setView}
              />
            </div>
          }
          bodyClassName="p-3"
        >
          {view === "strategies" ? (
            <Heatmap
              rows={rowsShown.map(
                (s) => `${s.rank}. ${FAMILY_BY_ID[s.genome.family].label} ${s.genome.symbol}`,
              )}
              columns={regimeLabels}
              cells={strategyCells}
              activeRow={rowsShown.findIndex((s) => s.genome.id === selectedId)}
              onRowClick={(index) => select(rowsShown[index].genome.id)}
              rowMeta={(index) => (
                <span
                  className={cx(
                    "ml-auto shrink-0 font-mono text-[10px] tnum",
                    rowsShown[index].outSample.sharpe > 0 ? "text-acid-400/70" : "text-cherry-400/70",
                  )}
                >
                  {num(rowsShown[index].outSample.sharpe)}
                </span>
              )}
            />
          ) : (
            <Heatmap
              rows={familyRows}
              columns={regimeLabels}
              cells={familyCells}
              rowWidth={150}
              cellHeight={34}
              rowMeta={(index) => (
                <span
                  className="ml-auto h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      FAMILY_COLORS[
                        (FAMILIES.find((f) => FAMILY_BY_ID[f.id].label === familyRows[index])?.id ??
                          "trend") as FamilyId
                      ],
                  }}
                />
              )}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
