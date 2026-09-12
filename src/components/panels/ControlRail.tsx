"use client";

import { FAMILIES } from "@/lib/engine/families";
import type { FamilyId, SearchConfig } from "@/lib/engine/types";
import { ASSET_SPECS } from "@/lib/engine/market";
import { FAMILY_COLORS } from "@/lib/palette";
import { useLab } from "@/lib/store";
import {
  Button,
  Checklist,
  Divider,
  NumberField,
  Segmented,
  Slider,
  cx,
} from "@/components/ui/primitives";

const OBJECTIVES: { value: SearchConfig["objective"]; label: string; title: string }[] = [
  { value: "robust", label: "Robust", title: "Mean in-sample Sharpe across thirds, penalized for dispersion" },
  { value: "sharpe", label: "Sharpe", title: "In-sample Sharpe ratio" },
  { value: "calmar", label: "Calmar", title: "Return divided by max drawdown" },
  { value: "return", label: "Return", title: "Compound annual growth rate" },
];

/** Left rail: everything that defines a run, grouped by the stage it affects. */
export function ControlRail({ className }: { className?: string }) {
  const config = useLab((s) => s.config);
  const setConfig = useLab((s) => s.setConfig);
  const resetConfig = useLab((s) => s.resetConfig);
  const status = useLab((s) => s.status);
  const customUniverse = useLab((s) => s.customUniverse);
  const running = status === "running";

  const universeSymbols = customUniverse
    ? customUniverse.series.map((s) => ({ value: s.symbol, label: s.symbol }))
    : ASSET_SPECS.map((a) => ({ value: a.symbol, label: a.symbol }));

  const evaluations = config.population * config.generations;

  return (
    <aside className={cx("flex flex-col gap-4 overflow-y-auto px-4 py-4", className)}>
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium text-ink-100">Search configuration</h2>
          <Button size="sm" variant="ghost" onClick={resetConfig} disabled={running}>
            Reset
          </Button>
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-ink-500">
          {`${evaluations.toLocaleString("en-US")} backtests per run, seeded and reproducible.`}
        </p>
      </div>

      <Divider label="Population" />

      <Slider
        label="Individuals"
        value={config.population}
        min={40}
        max={600}
        step={20}
        display={String(config.population)}
        onChange={(population) => setConfig({ population })}
        disabled={running}
        hint="Strategies evaluated per generation."
      />
      <Slider
        label="Generations"
        value={config.generations}
        min={3}
        max={40}
        display={String(config.generations)}
        onChange={(generations) => setConfig({ generations })}
        disabled={running}
        hint="Breeding rounds. More rounds refine, they do not diversify."
      />
      <Slider
        label="Mutation rate"
        value={config.mutationRate}
        min={0.05}
        max={0.9}
        step={0.05}
        display={config.mutationRate.toFixed(2)}
        onChange={(mutationRate) => setConfig({ mutationRate })}
        disabled={running}
      />
      <Slider
        label="Crossover rate"
        value={config.crossoverRate}
        min={0}
        max={0.95}
        step={0.05}
        display={config.crossoverRate.toFixed(2)}
        onChange={(crossoverRate) => setConfig({ crossoverRate })}
        disabled={running}
      />
      <Slider
        label="Elite fraction"
        value={config.eliteFraction}
        min={0.02}
        max={0.4}
        step={0.02}
        display={config.eliteFraction.toFixed(2)}
        onChange={(eliteFraction) => setConfig({ eliteFraction })}
        disabled={running}
        hint="Top share carried forward untouched."
      />

      <Divider label="Objective" />

      <div>
        <div className="label mb-1.5">Fitness</div>
        <Segmented
          size="sm"
          options={OBJECTIVES}
          value={config.objective}
          onChange={(objective) => setConfig({ objective })}
        />
      </div>
      <NumberField
        label="Minimum trades"
        value={config.minTrades}
        min={0}
        max={200}
        onChange={(minTrades) => setConfig({ minTrades })}
      />

      <Divider label="Search space" />

      <Checklist<FamilyId>
        label="Families"
        options={FAMILIES.map((f) => ({ value: f.id, label: f.label }))}
        selected={config.families}
        onChange={(families) => setConfig({ families })}
        colorFor={(id) => FAMILY_COLORS[id]}
      />
      <Checklist
        label="Instruments"
        options={universeSymbols}
        selected={config.symbols}
        onChange={(symbols) => setConfig({ symbols })}
      />

      <Divider label="Execution" />

      <Slider
        label="Vol target"
        value={config.volTarget}
        min={0.04}
        max={0.3}
        step={0.01}
        display={`${(config.volTarget * 100).toFixed(0)}%`}
        onChange={(volTarget) => setConfig({ volTarget })}
        disabled={running}
        hint="Seed value for position sizing genes."
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Cost"
          value={config.costBps}
          min={0}
          max={50}
          step={0.5}
          suffix="bps"
          onChange={(costBps) => setConfig({ costBps })}
        />
        <NumberField
          label="Slippage"
          value={config.slippageBps}
          min={0}
          max={50}
          step={0.5}
          suffix="bps"
          onChange={(slippageBps) => setConfig({ slippageBps })}
        />
      </div>

      <Divider label="Validation" />

      <Slider
        label="In-sample share"
        value={config.splitRatio}
        min={0.4}
        max={0.85}
        step={0.01}
        display={`${(config.splitRatio * 100).toFixed(0)}%`}
        onChange={(splitRatio) => setConfig({ splitRatio })}
        disabled={running}
        hint="The remainder is held out and never used for fitness."
      />
      <Slider
        label="Walk-forward folds"
        value={config.walkForwardFolds}
        min={2}
        max={10}
        display={String(config.walkForwardFolds)}
        onChange={(walkForwardFolds) => setConfig({ walkForwardFolds })}
        disabled={running}
      />

      <Divider label="Analysis" />

      <Slider
        label="Regime states"
        value={config.regimeStates}
        min={2}
        max={6}
        display={String(config.regimeStates)}
        onChange={(regimeStates) => setConfig({ regimeStates })}
        disabled={running}
        hint="Hidden states in the Gaussian HMM."
      />
      <div>
        <div className="label mb-1.5">Clusters</div>
        <Segmented
          size="sm"
          options={[
            { value: "auto", label: "Auto" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "6", label: "6" },
          ]}
          value={config.clusterCount === "auto" ? "auto" : String(config.clusterCount)}
          onChange={(value) =>
            setConfig({ clusterCount: value === "auto" ? "auto" : Number(value) })
          }
        />
      </div>

      <Divider label="Reproducibility" />

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <NumberField
          label="Seed"
          value={config.seed}
          min={1}
          step={1}
          onChange={(seed) => setConfig({ seed: Math.max(1, Math.round(seed)) })}
        />
        <Button
          variant="outline"
          onClick={() => setConfig({ seed: Math.floor(Math.random() * 90_000_000) + 1 })}
          disabled={running}
          title="Draw a new seed"
        >
          Shuffle
        </Button>
      </div>
      <p className="pb-2 text-2xs leading-relaxed text-ink-500">
        The seed drives price generation, the genetic search, the HMM start and the
        embedding. Same seed and settings, same run.
      </p>
    </aside>
  );
}
