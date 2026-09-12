/// <reference lib="webworker" />
import { fromPlainUniverse } from "@/lib/engine/csv";
import { detectRegimes } from "@/lib/engine/hmm";
import { drawdownSeries } from "@/lib/engine/metrics";
import { buildUniverse, evaluateManual, inspectStrategy, runSearch } from "@/lib/engine/search";
import { simpleReturns } from "@/lib/engine/indicators";
import { stdev } from "@/lib/engine/stats";
import type { Universe } from "@/lib/engine/types";
import type { UniversePreview, WorkerRequest, WorkerResponse } from "./protocol";

/**
 * Search worker.
 *
 * Everything expensive — genetic search, backtests, HMM fitting, t-SNE — runs
 * here so the UI thread never blocks. The long search yields between
 * generations, which is what lets a cancel message be delivered mid-run.
 */

let cancelRequested = false;

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

function resolveUniverse(req: WorkerRequest): Universe | undefined {
  if ("universe" in req && req.universe) return fromPlainUniverse(req.universe);
  return undefined;
}

async function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildPreview(universe: Universe, states: number, seed: number): UniversePreview {
  const regimes = detectRegimes(universe.benchmark, states, seed);
  const base = universe.benchmark[0] || 1;
  return {
    id: universe.id,
    label: universe.label,
    dates: universe.dates,
    benchmark: Array.from(universe.benchmark).map((v) => v / base),
    regimePath: Array.from(regimes.path),
    regimeLabels: regimes.states.map((s) => ({
      label: s.label,
      tone: s.tone,
      share: s.share,
      meanReturn: s.meanReturn,
      vol: s.vol,
    })),
    series: universe.series.map((s) => {
      const rets = simpleReturns(s.close);
      const dd = drawdownSeries(rets, 1, s.close.length);
      return {
        symbol: s.symbol,
        label: s.label,
        assetClass: s.assetClass,
        close: Array.from(s.close).map((v) => v / s.close[0]),
        total: s.close[s.close.length - 1] / s.close[0] - 1,
        vol: stdev(rets.subarray(1), 1) * Math.sqrt(252),
        maxDrawdown: Math.min(...dd),
      };
    }),
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  if (req.type === "cancel") {
    cancelRequested = true;
    return;
  }

  try {
    const universe = resolveUniverse(req);

    switch (req.type) {
      case "run": {
        cancelRequested = false;
        const run = await runSearch(
          req.config,
          (payload) => post({ type: "progress", requestId: req.requestId, payload }),
          () => cancelRequested,
          universe,
          nextTick,
        );
        if (cancelRequested && run.survivors.length === 0) {
          post({ type: "cancelled", requestId: req.requestId });
        } else {
          post({ type: "result", requestId: req.requestId, payload: run });
        }
        break;
      }
      case "inspect": {
        post({
          type: "inspection",
          requestId: req.requestId,
          payload: inspectStrategy(req.config, req.genome, universe),
        });
        break;
      }
      case "evaluate": {
        post({
          type: "evaluation",
          requestId: req.requestId,
          payload: evaluateManual(req.config, req.genome, universe),
        });
        break;
      }
      case "preview": {
        const u = universe ?? buildUniverse(req.config);
        post({
          type: "preview",
          requestId: req.requestId,
          payload: buildPreview(u, req.config.regimeStates, req.config.seed),
        });
        break;
      }
    }
  } catch (error) {
    post({
      type: "error",
      requestId: req.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
