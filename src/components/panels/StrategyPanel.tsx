"use client";

import { useMemo } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { BarRow, MonthlyGrid } from "@/components/charts/MiniCharts";
import { Button, EmptyState, Field, Panel, Stat, Tag, cx } from "@/components/ui/primitives";
import { FAMILY_BY_ID } from "@/lib/engine/families";
import { describeGenome, genomeName } from "@/lib/engine/genome";
import type { EvaluatedStrategy, Metrics, SearchRun } from "@/lib/engine/types";
import type { StrategyInspection } from "@/lib/engine/search";
import { int, num, pct, shortDate, signed, signedPct } from "@/lib/format";
import { FAMILY_COLORS, REGIME_COLORS, clusterColor } from "@/lib/palette";
import { useLab, useSelectedStrategy } from "@/lib/store";
import { regimeBands } from "./regime-bands";

/** Full inspection of one strategy: rules, metrics, curves, folds and trades. */
export function StrategyPanel() {
  const run = useLab((s) => s.run);
  const strategy = useSelectedStrategy();
  const inspection = useLab((s) => s.inspection);
  const inspecting = useLab((s) => s.inspecting);
  const setTab = useLab((s) => s.setTab);

  if (!run || !strategy) {
    return (
      <Panel className="min-h-[360px]">
        <EmptyState
          title="No strategy selected"
          body="Pick a survivor from the leaderboard or the cluster map to inspect its rules, walk-forward folds and trade history."
          action={
            run ? (
              <Button variant="outline" onClick={() => setTab("leaderboard")}>
                Open leaderboard
              </Button>
            ) : undefined
          }
        />
      </Panel>
    );
  }

  return (
    <StrategyContent
      run={run}
      strategy={strategy}
      inspection={inspection}
      inspecting={inspecting}
    />
  );
}

function StrategyContent({
  run,
  strategy,
  inspection,
  inspecting,
}: {
  run: SearchRun;
  strategy: EvaluatedStrategy;
  inspection: StrategyInspection | null;
  inspecting: boolean;
}) {
  const setTab = useLab((s) => s.setTab);
  const setEditorGenome = useLab((s) => s.setEditorGenome);
  const family = FAMILY_BY_ID[strategy.genome.family];
  const rules = useMemo(() => describeGenome(strategy.genome), [strategy]);

  const curveSeries = useMemo(() => {
    if (!inspection) return [];
    return [
      {
        id: "equity",
        label: "Strategy",
        values: inspection.equity,
        color: FAMILY_COLORS[strategy.genome.family],
        width: 1.8,
        fill: true,
      },
      {
        id: "bench",
        label: "Equal-weight universe",
        values: inspection.benchmark,
        color: "#5c6878",
        width: 1.1,
        dashed: true,
      },
      {
        id: "asset",
        label: `${strategy.genome.symbol} buy and hold`,
        values: inspection.price,
        color: "#3a4454",
        width: 1,
      },
    ];
  }, [inspection, strategy]);

  const bands = useMemo(() => {
    if (!inspection) return [];
    return regimeBands(run, 260, run.split.total, inspection.equity.length, 0.06);
  }, [inspection, run]);

  const splitIndex = useMemo(() => {
    if (!inspection) return undefined;
    const scored = run.split.total - 260;
    return Math.round(((run.split.isEnd - 260) / Math.max(1, scored)) * (inspection.equity.length - 1));
  }, [inspection, run]);

  const exitMix = useMemo(() => {
    if (!inspection) return [];
    const counts = new Map<string, number>();
    for (const trade of inspection.trades) {
      counts.set(trade.reason, (counts.get(trade.reason) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [inspection]);

  return (
    <div className="flex flex-col gap-3">
      <Panel bodyClassName="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="h-4 w-1 rounded-full"
                style={{ background: FAMILY_COLORS[strategy.genome.family] }}
              />
              <h2 className="text-sm font-medium text-ink-100">{family.label}</h2>
              <Tag color={FAMILY_COLORS[strategy.genome.family]}>{strategy.genome.symbol}</Tag>
              <Tag color={clusterColor(strategy.cluster)}>{`Cluster ${strategy.cluster}`}</Tag>
              <Tag>{`Rank ${strategy.rank}`}</Tag>
              <Tag>{strategy.genome.origin}</Tag>
              <Tag>{`gen ${strategy.genome.generation}`}</Tag>
            </div>
            <p className="mt-1.5 font-mono text-2xs text-ink-500">{genomeName(strategy.genome)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditorGenome(strategy.genome);
                setTab("editor");
              }}
            >
              Open in editor
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat
            label="OOS Sharpe"
            value={num(strategy.outSample.sharpe)}
            tone={strategy.outSample.sharpe > 0 ? "good" : "bad"}
            hint={`IS ${num(strategy.inSample.sharpe)}`}
          />
          <Stat
            label="CAGR"
            value={pct(strategy.outSample.cagr)}
            tone={strategy.outSample.cagr > 0 ? "good" : "bad"}
            hint={`vol ${pct(strategy.outSample.vol, 0)}`}
          />
          <Stat label="Max drawdown" value={pct(strategy.outSample.maxDrawdown)} tone="bad" hint={`ulcer ${num(strategy.outSample.ulcer, 3)}`} />
          <Stat label="Calmar" value={num(strategy.outSample.calmar)} hint={`sortino ${num(strategy.outSample.sortino)}`} />
          <Stat label="Win rate" value={pct(strategy.outSample.winRate, 0)} hint={`PF ${num(strategy.outSample.profitFactor)}`} />
          <Stat label="Trades" value={int(strategy.outSample.trades)} hint={`avg hold ${num(strategy.outSample.avgHold, 0)}d`} />
          <Stat
            label="Robustness"
            value={signed(strategy.robustness)}
            tone={strategy.robustness > 0 ? "good" : "bad"}
            hint={`${strategy.walkForward.length} folds`}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Equity, full history"
          subtitle="Log scale · dashed line marks the in-sample boundary · regime shading behind"
        >
          {inspection ? (
            <LineChart
              series={curveSeries}
              labels={inspection.dates}
              height={300}
              baseline={1}
              logScale
              bands={bands}
              splitIndex={splitIndex}
              splitLabel="out-of-sample"
              yFormat={(v) => `${v.toFixed(2)}x`}
            />
          ) : (
            <LoadingBlock busy={inspecting} height={300} />
          )}
        </Panel>

        <Panel title="Rule set" subtitle="Compiled from the genome">
          <ol className="space-y-2">
            {rules.map((rule, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 font-mono text-2xs text-ink-600">{`${i + 1}.`}</span>
                <span className="text-xs leading-relaxed text-ink-200">{rule}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 border-t border-ink-700/60 pt-3">
            <div className="label mb-1.5">Parameters</div>
            <div className="grid grid-cols-2 gap-x-5">
              {family.params.map((param) => (
                <Field key={param.key} label={param.label}>
                  {formatParam(strategy.genome.params[param.key])}
                </Field>
              ))}
              <Field label="Side">{strategy.genome.side}</Field>
              <Field label="Vol target">{pct(strategy.genome.risk.volTarget, 0)}</Field>
              <Field label="Max leverage">{`${num(strategy.genome.risk.maxLeverage)}x`}</Field>
              <Field label="Stop / target">
                {`${formatParam(strategy.genome.risk.stopAtr) } / ${formatParam(strategy.genome.risk.takeAtr)} ATR`}
              </Field>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="Drawdown" subtitle="Peak-to-trough, full history">
          {inspection ? (
            <LineChart
              series={[
                {
                  id: "dd",
                  label: "Drawdown",
                  values: inspection.drawdown,
                  color: "#f4506c",
                  width: 1.2,
                  fill: true,
                },
              ]}
              labels={inspection.dates}
              height={180}
              baseline={0}
              yFormat={(v) => pct(v, 0)}
              showLegend={false}
            />
          ) : (
            <LoadingBlock busy={inspecting} height={180} />
          )}
        </Panel>

        <Panel title="Walk-forward folds" subtitle="Each fold is scored on bars the prior folds never saw">
          <div className="divide-y divide-ink-700/40">
            {strategy.walkForward.map((fold) => (
              <BarRow
                key={fold.fold}
                label={`Fold ${fold.fold}`}
                value={fold.sharpe}
                max={Math.max(0.5, ...strategy.walkForward.map((f) => Math.abs(f.sharpe)))}
                color="#6b8cff"
                display={num(fold.sharpe)}
                sub={`${fold.test.label} · CAGR ${pct(fold.cagr, 0)} · DD ${pct(fold.maxDrawdown, 0)}`}
              />
            ))}
            {strategy.walkForward.length === 0 && (
              <p className="py-2 text-xs text-ink-500">Not enough history for folds.</p>
            )}
          </div>
        </Panel>

        <Panel title="Sharpe by regime" subtitle="Where the returns actually came from">
          <div className="divide-y divide-ink-700/40">
            {run.regimes.states.map((state, i) => (
              <BarRow
                key={state.id}
                label={state.label}
                value={strategy.regimeSharpe[i] ?? 0}
                max={Math.max(0.5, ...strategy.regimeSharpe.map((v) => Math.abs(v)))}
                color={REGIME_COLORS[state.tone] ?? "#3a4454"}
                display={num(strategy.regimeSharpe[i] ?? 0)}
                sub={`exposure ${pct(strategy.regimeExposure[i] ?? 0, 0)} · ${pct(state.share, 0)} of bars`}
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Monthly returns" subtitle="Full history, percent per month">
          {inspection ? (
            <MonthlyGrid monthly={inspection.monthly} />
          ) : (
            <LoadingBlock busy={inspecting} height={200} />
          )}
        </Panel>

        <Panel title="Trades" subtitle="Most recent 160 closed positions" bodyClassName="p-0">
          {inspection ? (
            <>
              <div className="flex flex-wrap gap-2 border-b border-ink-700/60 px-4 py-2.5">
                {exitMix.map(([reason, count]) => (
                  <Tag key={reason}>{`${reason} ${count}`}</Tag>
                ))}
              </div>
              <div className="max-h-[280px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-ink-900">
                    <tr className="border-b border-ink-700/60 text-ink-500">
                      <th className="px-4 py-1.5 text-left font-normal">Entry</th>
                      <th className="px-2 py-1.5 text-left font-normal">Exit</th>
                      <th className="px-2 py-1.5 text-right font-normal">Side</th>
                      <th className="px-2 py-1.5 text-right font-normal">Bars</th>
                      <th className="px-2 py-1.5 text-right font-normal">Return</th>
                      <th className="px-4 py-1.5 text-right font-normal">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspection.trades
                      .slice()
                      .reverse()
                      .map((trade, i) => (
                        <tr key={`${trade.entry}-${i}`} className="border-b border-ink-800/60">
                          <td className="px-4 py-1.5 font-mono text-2xs text-ink-300 tnum">
                            {shortDate(trade.entry)}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-2xs text-ink-400 tnum">
                            {shortDate(trade.exit)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-2xs">
                            <span className={trade.direction > 0 ? "text-acid-400" : "text-flare-400"}>
                              {trade.direction > 0 ? "long" : "short"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-2xs text-ink-400 tnum">
                            {trade.bars}
                          </td>
                          <td
                            className={cx(
                              "px-2 py-1.5 text-right font-mono text-2xs tnum",
                              trade.returnPct >= 0 ? "text-acid-400" : "text-cherry-400",
                            )}
                          >
                            {signedPct(trade.returnPct, 2)}
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono text-2xs text-ink-500">
                            {trade.reason}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-4">
              <LoadingBlock busy={inspecting} height={240} />
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Metric detail" subtitle="In-sample against held-out" bodyClassName="p-0">
        <MetricCompare is={strategy.inSample} oos={strategy.outSample} full={inspection?.full} />
      </Panel>
    </div>
  );
}

function MetricCompare({
  is,
  oos,
  full,
}: {
  is: Metrics;
  oos: Metrics;
  full?: Metrics;
}) {
  const rows: { label: string; key: keyof Metrics; format: (v: number) => string }[] = [
    { label: "Sharpe", key: "sharpe", format: (v) => num(v) },
    { label: "Sortino", key: "sortino", format: (v) => num(v) },
    { label: "CAGR", key: "cagr", format: (v) => pct(v) },
    { label: "Volatility", key: "vol", format: (v) => pct(v) },
    { label: "Max drawdown", key: "maxDrawdown", format: (v) => pct(v) },
    { label: "Calmar", key: "calmar", format: (v) => num(v) },
    { label: "Ulcer index", key: "ulcer", format: (v) => num(v, 3) },
    { label: "Win rate", key: "winRate", format: (v) => pct(v, 0) },
    { label: "Profit factor", key: "profitFactor", format: (v) => num(v) },
    { label: "Trades", key: "trades", format: (v) => int(v) },
    { label: "Avg hold (bars)", key: "avgHold", format: (v) => num(v, 1) },
    { label: "Exposure", key: "exposure", format: (v) => pct(v, 0) },
    { label: "Turnover", key: "turnover", format: (v) => num(v, 1) },
    { label: "Return skew", key: "skew", format: (v) => num(v) },
    { label: "Excess kurtosis", key: "kurtosis", format: (v) => num(v, 1) },
    { label: "Tail ratio", key: "tailRatio", format: (v) => num(v) },
    { label: "Benchmark corr", key: "benchCorr", format: (v) => num(v) },
    { label: "Best month", key: "bestMonth", format: (v) => signedPct(v) },
    { label: "Worst month", key: "worstMonth", format: (v) => signedPct(v) },
  ];

  return (
    <div className="grid grid-cols-1 gap-x-8 px-4 py-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-baseline justify-between gap-3 border-b border-ink-800/60 py-1.5"
        >
          <span className="text-2xs text-ink-400">{row.label}</span>
          <span className="flex items-baseline gap-3 font-mono text-2xs tnum">
            <span className="w-16 text-right text-ink-500">{row.format(is[row.key])}</span>
            <span className="w-16 text-right text-ink-100">{row.format(oos[row.key])}</span>
            {full && <span className="w-16 text-right text-ink-500">{row.format(full[row.key])}</span>}
          </span>
        </div>
      ))}
      <div className="col-span-full flex justify-end gap-3 pt-2 font-mono text-[10px] text-ink-600">
        <span className="w-16 text-right">in-sample</span>
        <span className="w-16 text-right">held-out</span>
        {full && <span className="w-16 text-right">full</span>}
      </div>
    </div>
  );
}

function formatParam(value: number): string {
  if (value === undefined || !Number.isFinite(value)) return "–";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function LoadingBlock({ busy, height }: { busy: boolean; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded border border-dashed border-ink-700/70"
      style={{ height }}
    >
      <span className="font-mono text-2xs text-ink-500">
        {busy ? "Re-running full history…" : "No detail loaded"}
      </span>
    </div>
  );
}
