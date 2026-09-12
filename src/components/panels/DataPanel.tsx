"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { RegimeRibbon } from "@/components/charts/MiniCharts";
import { Button, Field, Panel, Stat, Tag, cx } from "@/components/ui/primitives";
import { pct, signedPct } from "@/lib/format";
import { REGIME_COLORS } from "@/lib/palette";
import { useLab } from "@/lib/store";
import { scoredBands } from "./regime-bands";

const SERIES_COLORS = [
  "#35e0a1",
  "#6b8cff",
  "#ff7a45",
  "#f2c94c",
  "#c77dff",
  "#4fd1c5",
  "#f4506c",
  "#8b95a5",
];

/**
 * Data tab.
 *
 * Shows exactly what the search is trading: the generated universe, its fitted
 * regimes and per-instrument statistics. A CSV can be imported to run the same
 * pipeline over real history — the parser accepts one instrument per file or a
 * long file with a symbol column.
 */
export function DataPanel() {
  const preview = useLab((s) => s.preview);
  const loading = useLab((s) => s.previewLoading);
  const refresh = useLab((s) => s.refreshPreview);
  const importCsv = useLab((s) => s.importCsv);
  const clearCsv = useLab((s) => s.clearCsv);
  const customUniverse = useLab((s) => s.customUniverse);
  const csvReport = useLab((s) => s.csvReport);
  const config = useLab((s) => s.config);
  const run = useLab((s) => s.run);

  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [visible, setVisible] = useState<string[] | null>(null);

  useEffect(() => {
    if (!preview && !loading) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    if (!preview) return [];
    const allow = visible ?? preview.series.map((s) => s.symbol);
    return preview.series.filter((s) => allow.includes(s.symbol));
  }, [preview, visible]);

  const priceSeries = useMemo(
    () =>
      shown.map((s, i) => ({
        id: s.symbol,
        label: s.symbol,
        values: s.close,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        width: 1.2,
      })),
    [shown],
  );

  const bands = useMemo(
    () => (preview && run ? scoredBands(run, preview.dates.length, 0.07) : []),
    [preview, run],
  );

  const readFile = async (file: File) => {
    const text = await file.text();
    importCsv(text, file.name.replace(/\.csv$/i, ""));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_330px]">
        <Panel
          title={preview?.label ?? "Universe"}
          subtitle={
            preview
              ? `${preview.series.length} instruments · ${preview.dates.length} bars · ${preview.dates[0]} to ${preview.dates[preview.dates.length - 1]}`
              : "Loading price history"
          }
          actions={
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          }
        >
          {preview ? (
            <>
              <LineChart
                series={priceSeries}
                labels={preview.dates}
                height={300}
                logScale
                baseline={1}
                bands={bands}
                yFormat={(v) => `${v.toFixed(1)}x`}
              />
              <div className="mt-3">
                <RegimeRibbon
                  path={preview.regimePath}
                  colors={preview.regimeLabels.map((r) => REGIME_COLORS[r.tone] ?? "#3a4454")}
                  labels={preview.regimeLabels.map((r) => r.label)}
                  dates={preview.dates}
                  height={13}
                />
              </div>
            </>
          ) : (
            <div className="flex h-[300px] items-center justify-center">
              <span className="font-mono text-2xs text-ink-500">
                {loading ? "Generating universe…" : "No preview"}
              </span>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Import CSV" subtitle="Run the pipeline over your own history">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void readFile(file);
              }}
              className={cx(
                "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
                dragging ? "border-acid-500 bg-acid-500/5" : "border-ink-600",
              )}
            >
              <p className="text-xs text-ink-300">Drop a CSV here</p>
              <p className="text-2xs leading-relaxed text-ink-500">
                Needs a date column and a close column. A symbol column turns the file into a
                multi-instrument universe.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
            </div>

            {csvReport && (
              <div className="mt-3 space-y-1.5 border-t border-ink-700/60 pt-3">
                <Field label="Rows kept">{csvReport.rowsKept.toLocaleString("en-US")}</Field>
                <Field label="Symbols">{csvReport.symbols.length}</Field>
                <div className="flex flex-wrap gap-1 pt-1">
                  {csvReport.symbols.slice(0, 14).map((symbol) => (
                    <Tag key={symbol}>{symbol}</Tag>
                  ))}
                </div>
                {csvReport.warnings.map((warning) => (
                  <p key={warning} className="pt-1 text-2xs leading-relaxed text-flare-400">
                    {warning}
                  </p>
                ))}
              </div>
            )}

            {customUniverse && (
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-700/60 pt-3">
                <span className="truncate text-2xs text-ink-300">{customUniverse.label}</span>
                <Button size="sm" variant="danger" onClick={clearCsv}>
                  Use synthetic
                </Button>
              </div>
            )}
          </Panel>

          <Panel
            title="Fitted regimes"
            subtitle={
              preview
                ? `${preview.regimeLabels.length} of ${config.regimeStates} states occupied`
                : `${config.regimeStates} hidden states`
            }
          >
            {preview ? (
              <div className="space-y-2">
                {preview.regimeLabels.map((state, i) => (
                  <div key={`${state.label}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: REGIME_COLORS[state.tone] ?? "#3a4454" }}
                      />
                      <span className="truncate text-xs text-ink-200">{state.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-ink-400 tnum">
                      {`${pct(state.share, 0)} · ${signedPct(state.meanReturn, 0)} · ${pct(state.vol, 0)}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-500">Waiting for the preview.</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Instruments"
        subtitle="Click to show or hide a series in the chart above"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-ink-700/60 text-ink-500">
                <th className="px-4 py-2 text-left font-normal">Symbol</th>
                <th className="px-3 py-2 text-left font-normal">Description</th>
                <th className="px-3 py-2 text-left font-normal">Class</th>
                <th className="px-3 py-2 text-right font-normal">Total return</th>
                <th className="px-3 py-2 text-right font-normal">Ann. vol</th>
                <th className="px-4 py-2 text-right font-normal">Max drawdown</th>
              </tr>
            </thead>
            <tbody>
              {preview?.series.map((series, i) => {
                const on = shown.some((s) => s.symbol === series.symbol);
                return (
                  <tr
                    key={series.symbol}
                    onClick={() => {
                      const allow = visible ?? preview.series.map((s) => s.symbol);
                      const next = allow.includes(series.symbol)
                        ? allow.filter((s) => s !== series.symbol)
                        : [...allow, series.symbol];
                      setVisible(next.length ? next : allow);
                    }}
                    className={cx(
                      "cursor-pointer border-b border-ink-800/70 transition-colors hover:bg-ink-850/70",
                      !on && "opacity-40",
                    )}
                  >
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                        />
                        <span className="font-mono text-ink-100">{series.symbol}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-300">{series.label}</td>
                    <td className="px-3 py-2 text-ink-500">{series.assetClass}</td>
                    <td
                      className={cx(
                        "px-3 py-2 text-right font-mono tnum",
                        series.total >= 0 ? "text-acid-400" : "text-cherry-400",
                      )}
                    >
                      {signedPct(series.total, 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-300 tnum">
                      {pct(series.vol, 0)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-cherry-400/85 tnum">
                      {pct(series.maxDrawdown, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="How the synthetic universe is built" bodyClassName="p-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <h3 className="text-xs font-medium text-ink-200">Latent regime chain</h3>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">
              A four-state Markov process sets the market drift and volatility level, with mean
              durations from 45 to 180 bars. A stochastic-volatility multiplier clusters volatility
              inside each state, so calm and turbulent stretches persist the way they do in real
              markets.
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-ink-200">Instrument dynamics</h3>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">
              Each instrument loads on the shared market factor with its own beta, drift,
              idiosyncratic volatility, return autocorrelation and jump intensity. Negative
              autocorrelation gives the mean-reversion family something real to trade; positive
              autocorrelation rewards trend and breakout.
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-ink-200">Why synthetic at all</h3>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">
              No vendor key, no network call, and a seed that reproduces the entire run bar for bar.
              Import a CSV whenever you want the same search over real history — the engine does not
              care where the bars came from.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink-700/60 pt-3 sm:grid-cols-4">
          <Stat label="Seed" value={String(config.seed)} />
          <Stat label="Bars" value={preview ? String(preview.dates.length) : "–"} />
          <Stat label="Instruments" value={preview ? String(preview.series.length) : "–"} />
          <Stat label="Source" value={customUniverse ? "CSV import" : "Generated"} mono={false} />
        </div>
      </Panel>
    </div>
  );
}
