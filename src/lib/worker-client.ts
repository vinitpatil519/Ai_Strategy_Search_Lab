"use client";

import type { PlainUniverse } from "./engine/csv";
import type { ManualEvaluation, SearchProgress, StrategyInspection } from "./engine/search";
import type { Genome, SearchConfig, SearchRun } from "./engine/types";
import type { UniversePreview, WorkerRequest, WorkerResponse } from "@/worker/protocol";

/**
 * Thin promise wrapper around the search worker.
 *
 * One worker is reused for the life of the tab: spinning it up costs a module
 * graph parse, and the indicator caches inside a run are worth keeping warm.
 * Requests are correlated by id so a slow search cannot resolve a later
 * inspection request by accident.
 */

type Handlers = {
  onProgress?: (p: SearchProgress) => void;
};

let worker: Worker | null = null;
let nextId = 1;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  handlers: Handlers;
}

const pending = new Map<number, Pending>();

/** Omit that distributes over the request union, so each variant keeps its own
 *  shape instead of collapsing to the shared keys. */
type RequestBody = WorkerRequest extends infer T
  ? T extends WorkerRequest
    ? Omit<T, "requestId">
    : never
  : never;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../worker/engine.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    switch (msg.type) {
      case "progress":
        entry.handlers.onProgress?.(msg.payload);
        break;
      case "error":
        pending.delete(msg.requestId);
        entry.reject(new Error(msg.message));
        break;
      case "cancelled":
        pending.delete(msg.requestId);
        entry.reject(new Error("cancelled"));
        break;
      default:
        pending.delete(msg.requestId);
        entry.resolve(msg.payload);
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Worker failed");
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(error);
    }
  };
  return worker;
}

function send<T>(request: RequestBody, handlers: Handlers = {}): Promise<T> {
  const w = ensureWorker();
  const requestId = nextId++;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, handlers });
  });
  w.postMessage({ ...request, requestId } as WorkerRequest);
  return promise;
}

export function startSearch(
  config: SearchConfig,
  universe: PlainUniverse | undefined,
  onProgress: (p: SearchProgress) => void,
): Promise<SearchRun> {
  return send<SearchRun>({ type: "run", config, universe }, { onProgress });
}

export function cancelSearch(): void {
  if (!worker) return;
  worker.postMessage({ type: "cancel", requestId: 0 } satisfies WorkerRequest);
}

export function inspect(
  config: SearchConfig,
  genome: Genome,
  universe?: PlainUniverse,
): Promise<StrategyInspection> {
  return send<StrategyInspection>({ type: "inspect", config, genome, universe });
}

export function evaluateGenome(
  config: SearchConfig,
  genome: Genome,
  universe?: PlainUniverse,
): Promise<ManualEvaluation> {
  return send<ManualEvaluation>({ type: "evaluate", config, genome, universe });
}

export function loadPreview(
  config: SearchConfig,
  universe?: PlainUniverse,
): Promise<UniversePreview> {
  return send<UniversePreview>({ type: "preview", config, universe });
}
