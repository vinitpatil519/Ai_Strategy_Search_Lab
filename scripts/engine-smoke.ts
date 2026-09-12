/**
 * Engine smoke test.
 *
 * Runs the whole pipeline headless — universe generation, regime fitting,
 * genetic search, walk-forward scoring, clustering, single-strategy inspection —
 * and prints the shape of the result. Useful for checking the numerics without
 * booting the UI.
 *
 *   npm run smoke
 */
import { detectRegimes } from "../src/lib/engine/hmm";
import { generateUniverse } from "../src/lib/engine/market";
import { defaultConfig, inspectStrategy, runSearch } from "../src/lib/engine/search";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

async function main() {
  const started = Date.now();

  const universe = generateUniverse(20260912);
  console.log(
    `universe: ${universe.series.length} instruments, ${universe.dates.length} bars, ${universe.dates[0]} to ${universe.dates[universe.dates.length - 1]}`,
  );

  const regimes = detectRegimes(universe.benchmark, 4, 11);
  console.log(`hmm: ${regimes.iterations} iterations, logL ${regimes.logLikelihood.toFixed(1)}, ${regimes.segments.length} segments`);
  for (const s of regimes.states) {
    console.log(
      `  ${s.label.padEnd(20)} share ${pct(s.share).padStart(6)}  drift ${pct(s.meanReturn).padStart(8)}  vol ${pct(s.vol).padStart(7)}  avg len ${s.avgLength.toFixed(0)}`,
    );
  }

  const config = { ...defaultConfig(), population: 80, generations: 6 };
  const run = await runSearch(config, (p) => {
    if (p.phase !== "search") return;
    console.log(`  gen ${p.generation}: best ${p.best?.toFixed(3)}, evaluated ${p.evaluated}, ${p.stat?.elapsedMs}ms`);
  });

  console.log(`search: ${run.evaluated} evaluations, ${run.survivors.length} survivors, ${run.clusters.length} clusters`);
  console.log(`split: in-sample ${run.split.isLabel} | out-of-sample ${run.split.oosLabel}`);
  for (const s of run.survivors.slice(0, 8)) {
    console.log(
      `  #${String(s.rank).padStart(2)} ${s.genome.family.padEnd(14)} ${s.genome.symbol.padEnd(5)} IS ${s.inSample.sharpe.toFixed(2).padStart(6)}  OOS ${s.outSample.sharpe.toFixed(2).padStart(6)}  cagr ${pct(s.outSample.cagr).padStart(8)}  dd ${pct(s.outSample.maxDrawdown).padStart(8)}  trades ${String(s.outSample.trades).padStart(4)}  cluster ${s.cluster}`,
    );
  }
  for (const c of run.clusters) {
    console.log(`  cluster ${c.id}: ${c.label} (n=${c.size}, mean OOS sharpe ${c.centroidMetrics.sharpe.toFixed(2)})`);
  }

  const top = run.survivors[0];
  const inspection = inspectStrategy(config, top.genome);
  console.log(
    `inspect ${inspection.name}: ${inspection.trades.length} trades, ${inspection.monthly.length} months, final equity ${inspection.equity[inspection.equity.length - 1].toFixed(3)}`,
  );

  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
