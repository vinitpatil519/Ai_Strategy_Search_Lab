"use client";

import { useEffect, useMemo } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { BarRow } from "@/components/charts/MiniCharts";
import {
  Button,
  Divider,
  EmptyState,
  Field,
  Panel,
  Segmented,
  Slider,
  Stat,
  Tag,
  cx,
} from "@/components/ui/primitives";
import { FAMILIES, FAMILY_BY_ID, RISK_SPECS } from "@/lib/engine/families";
import { describeGenome, newId, randomGenome, repair } from "@/lib/engine/genome";
import { mulberry32 } from "@/lib/engine/rng";
import type { FamilyId, Genome, Side } from "@/lib/engine/types";
import { int, num, pct, signed } from "@/lib/format";
import { FAMILY_COLORS } from "@/lib/palette";
import { useLab } from "@/lib/store";

/**
 * Strategy editor.
 *
 * Any survivor can be dropped in here, re-parameterized by hand and re-scored
 * against the exact same split the search used — which is the fastest way to
 * find out whether a leaderboard entry is a real effect or a parameter artefact.
 */
export function EditorPanel() {
  const genome = useLab((s) => s.editorGenome);
  const setGenome = useLab((s) => s.setEditorGenome);
  const config = useLab((s) => s.config);
  const customUniverse = useLab((s) => s.customUniverse);

  const symbols = useMemo(
    () =>
      customUniverse
        ? customUniverse.series.map((s) => s.symbol)
        : config.symbols,
    [customUniverse, config.symbols],
  );

  useEffect(() => {
    if (genome) return;
    // Seed the editor with a random, valid genome so the panel is never empty.
    const rng = mulberry32(config.seed ^ 0x5f3a);
    setGenome(randomGenome(rng, config.families, symbols, config.volTarget, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!genome) {
    return (
      <Panel className="min-h-[340px]">
        <EmptyState title="Editor empty" body="Open a survivor from the leaderboard to edit it." />
      </Panel>
    );
  }

  return <EditorContent genome={genome} symbols={symbols} />;
}

function EditorContent({ genome, symbols }: { genome: Genome; symbols: string[] }) {
  const patch = useLab((s) => s.patchEditorGenome);
  const setGenome = useLab((s) => s.setEditorGenome);
  const evaluate = useLab((s) => s.evaluateEditor);
  const result = useLab((s) => s.editorResult);
  const busy = useLab((s) => s.editorBusy);
  const config = useLab((s) => s.config);

  const family = FAMILY_BY_ID[genome.family];
  const rules = useMemo(() => describeGenome(genome), [genome]);

  const setParam = (key: string, value: number) => {
    const params = { ...genome.params, [key]: value };
    repair(genome.family, params);
    patch({ params });
  };

  const setRisk = (key: keyof Genome["risk"], value: number) => {
    patch({ risk: { ...genome.risk, [key]: value } });
  };

  const switchFamily = (next: FamilyId) => {
    if (next === genome.family) return;
    const rng = mulberry32((config.seed ^ next.length ^ Date.now()) >>> 0);
    const fresh = randomGenome(rng, [next], [genome.symbol], genome.risk.volTarget, 0);
    setGenome({ ...fresh, id: newId(), risk: genome.risk, side: genome.side, origin: "manual" });
  };

  const decay =
    result && result.isMetrics.sharpe !== 0
      ? 1 - result.oosMetrics.sharpe / result.isMetrics.sharpe
      : 0;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[360px_1fr]">
      <Panel title="Genome" subtitle="Edit, then re-score against the same split" bodyClassName="p-4">
        <div>
          <div className="label mb-1.5">Family</div>
          <div className="flex flex-wrap gap-1">
            {FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => switchFamily(f.id)}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded border px-1.5 py-1 text-2xs transition-colors",
                  f.id === genome.family
                    ? "border-ink-500 bg-ink-750 text-ink-100"
                    : "border-ink-700/70 text-ink-500 hover:border-ink-600 hover:text-ink-300",
                )}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: f.id === genome.family ? FAMILY_COLORS[f.id] : "#3a4454" }}
                />
                {f.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-ink-500">{family.blurb}</p>
        </div>

        <Divider label="Instrument" />
        <div className="flex flex-wrap gap-1">
          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => patch({ symbol })}
              className={cx(
                "rounded border px-1.5 py-1 font-mono text-2xs transition-colors",
                symbol === genome.symbol
                  ? "border-ink-500 bg-ink-750 text-ink-100"
                  : "border-ink-700/70 text-ink-500 hover:border-ink-600 hover:text-ink-300",
              )}
            >
              {symbol}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <div className="label mb-1.5">Side</div>
          <Segmented<Side>
            size="sm"
            options={[
              { value: "long", label: "Long" },
              { value: "short", label: "Short" },
              { value: "both", label: "Both" },
            ]}
            value={genome.side}
            onChange={(side) => patch({ side })}
          />
        </div>

        <Divider label="Rule parameters" />
        <div className="space-y-3.5">
          {family.params.map((param) => (
            <Slider
              key={param.key}
              label={param.label}
              value={genome.params[param.key] ?? param.min}
              min={param.min}
              max={param.max}
              step={param.step ?? (param.integer ? 1 : 0.01)}
              display={
                param.integer
                  ? String(Math.round(genome.params[param.key] ?? 0))
                  : (genome.params[param.key] ?? 0).toFixed(2)
              }
              onChange={(value) => setParam(param.key, value)}
              hint={param.hint}
            />
          ))}
        </div>

        <Divider label="Risk genes" />
        <div className="space-y-3.5">
          {RISK_SPECS.map((spec) => (
            <Slider
              key={spec.key}
              label={spec.label}
              value={genome.risk[spec.key as keyof Genome["risk"]]}
              min={spec.min}
              max={spec.max}
              step={spec.step ?? (spec.integer ? 1 : 0.01)}
              display={
                spec.key === "volTarget"
                  ? pct(genome.risk.volTarget, 0)
                  : spec.integer
                    ? String(Math.round(genome.risk[spec.key as keyof Genome["risk"]]))
                    : num(genome.risk[spec.key as keyof Genome["risk"]])
              }
              onChange={(value) => setRisk(spec.key as keyof Genome["risk"], value)}
              hint={spec.hint}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button variant="primary" onClick={() => void evaluate()} disabled={busy}>
            {busy ? "Scoring…" : "Backtest"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const rng = mulberry32((Date.now() ^ config.seed) >>> 0);
              setGenome(randomGenome(rng, [genome.family], symbols, genome.risk.volTarget, 0));
            }}
          >
            Randomize
          </Button>
        </div>
      </Panel>

      <div className="flex flex-col gap-3">
        <Panel title="Compiled rules" subtitle="What this genome actually does">
          <ol className="grid gap-2 sm:grid-cols-2">
            {rules.map((rule, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 font-mono text-2xs text-ink-600">{`${i + 1}.`}</span>
                <span className="text-xs leading-relaxed text-ink-200">{rule}</span>
              </li>
            ))}
          </ol>
        </Panel>

        {result ? (
          <>
            <Panel bodyClassName="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
                <Stat
                  label="IS Sharpe"
                  value={num(result.isMetrics.sharpe)}
                  tone={result.isMetrics.sharpe > 0 ? "good" : "bad"}
                  hint={`${int(result.isMetrics.trades)} trades`}
                />
                <Stat
                  label="OOS Sharpe"
                  value={num(result.oosMetrics.sharpe)}
                  tone={result.oosMetrics.sharpe > 0 ? "good" : "bad"}
                  hint={`${int(result.oosMetrics.trades)} trades`}
                />
                <Stat
                  label="Decay"
                  value={pct(decay, 0)}
                  tone={decay < 0.35 ? "good" : decay < 0.7 ? "neutral" : "bad"}
                />
                <Stat
                  label="OOS CAGR"
                  value={pct(result.oosMetrics.cagr)}
                  tone={result.oosMetrics.cagr > 0 ? "good" : "bad"}
                />
                <Stat label="OOS max DD" value={pct(result.oosMetrics.maxDrawdown)} tone="bad" />
                <Stat label="Exposure" value={pct(result.oosMetrics.exposure, 0)} />
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
              <Panel title="Equity" subtitle="Full history, log scale">
                <LineChart
                  series={[
                    {
                      id: "manual",
                      label: "Edited genome",
                      values: result.equity,
                      color: FAMILY_COLORS[genome.family],
                      width: 1.7,
                      fill: true,
                    },
                  ]}
                  labels={result.dates}
                  height={250}
                  baseline={1}
                  logScale
                  yFormat={(v) => `${v.toFixed(2)}x`}
                  showLegend={false}
                />
              </Panel>
              <Panel title="Walk-forward" subtitle="Sharpe per out-of-sample block">
                <div className="divide-y divide-ink-700/40">
                  {result.folds.map((fold) => (
                    <BarRow
                      key={fold.fold}
                      label={`Fold ${fold.fold}`}
                      value={fold.sharpe}
                      max={Math.max(0.5, ...result.folds.map((f) => Math.abs(f.sharpe)))}
                      color="#6b8cff"
                      display={num(fold.sharpe)}
                      sub={fold.test.label}
                    />
                  ))}
                  {result.folds.length === 0 && (
                    <p className="py-2 text-xs text-ink-500">Not enough history for folds.</p>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-5 border-t border-ink-700/60 pt-2">
                  <Field label="Win rate">{pct(result.oosMetrics.winRate, 0)}</Field>
                  <Field label="Profit factor">{num(result.oosMetrics.profitFactor)}</Field>
                  <Field label="Avg hold">{`${num(result.oosMetrics.avgHold, 0)}d`}</Field>
                  <Field label="Benchmark corr">{signed(result.oosMetrics.benchCorr)}</Field>
                </div>
              </Panel>
            </div>
          </>
        ) : (
          <Panel className="min-h-[240px]">
            <EmptyState
              title="Not scored yet"
              body="Adjust the genome and hit Backtest. The run uses the same universe, costs and in-sample split as the search, so results are directly comparable to the leaderboard."
              action={
                <Button variant="primary" onClick={() => void evaluate()} disabled={busy}>
                  {busy ? "Scoring…" : "Backtest"}
                </Button>
              }
            />
          </Panel>
        )}

        <div className="flex flex-wrap items-center gap-2 px-1">
          <Tag>{`seed ${config.seed}`}</Tag>
          <Tag>{`costs ${config.costBps + config.slippageBps} bps`}</Tag>
          <Tag>{`in-sample ${pct(config.splitRatio, 0)}`}</Tag>
          <Tag>{`origin ${genome.origin}`}</Tag>
        </div>
      </div>
    </div>
  );
}
