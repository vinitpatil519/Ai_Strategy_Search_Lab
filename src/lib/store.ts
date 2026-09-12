"use client";

import { create } from "zustand";
import { parseCsvUniverse, toPlainUniverse, type PlainUniverse } from "./engine/csv";
import { defaultConfig } from "./engine/search";
import type { ManualEvaluation, SearchProgress, StrategyInspection } from "./engine/search";
import type { EvaluatedStrategy, Genome, SearchConfig, SearchRun } from "./engine/types";
import type { UniversePreview } from "@/worker/protocol";
import {
  cancelSearch,
  evaluateGenome,
  inspect,
  loadPreview,
  startSearch,
} from "./worker-client";

export type TabId =
  | "overview"
  | "leaderboard"
  | "clusters"
  | "regimes"
  | "strategy"
  | "editor"
  | "data";

export type RunStatus = "idle" | "running" | "done" | "cancelled" | "error";

interface LabState {
  config: SearchConfig;
  status: RunStatus;
  progress: SearchProgress | null;
  run: SearchRun | null;
  error: string | null;
  tab: TabId;
  selectedId: string | null;
  inspection: StrategyInspection | null;
  inspecting: boolean;
  preview: UniversePreview | null;
  previewLoading: boolean;
  customUniverse: PlainUniverse | null;
  csvReport: { rowsKept: number; symbols: string[]; warnings: string[] } | null;
  editorGenome: Genome | null;
  editorResult: ManualEvaluation | null;
  editorBusy: boolean;
  clusterFilter: number | null;
  familyFilter: string | null;

  setConfig: (patch: Partial<SearchConfig>) => void;
  resetConfig: () => void;
  setTab: (tab: TabId) => void;
  startRun: () => Promise<void>;
  cancel: () => void;
  select: (id: string | null) => void;
  refreshPreview: () => Promise<void>;
  importCsv: (text: string, name: string) => void;
  clearCsv: () => void;
  setEditorGenome: (genome: Genome | null) => void;
  patchEditorGenome: (patch: Partial<Genome>) => void;
  evaluateEditor: () => Promise<void>;
  setClusterFilter: (id: number | null) => void;
  setFamilyFilter: (id: string | null) => void;
}

export const useLab = create<LabState>((set, get) => ({
  config: defaultConfig(),
  status: "idle",
  progress: null,
  run: null,
  error: null,
  tab: "overview",
  selectedId: null,
  inspection: null,
  inspecting: false,
  preview: null,
  previewLoading: false,
  customUniverse: null,
  csvReport: null,
  editorGenome: null,
  editorResult: null,
  editorBusy: false,
  clusterFilter: null,
  familyFilter: null,

  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  resetConfig: () => set({ config: defaultConfig() }),
  setTab: (tab) => set({ tab }),

  startRun: async () => {
    if (get().status === "running") return;
    set({ status: "running", error: null, progress: null, inspection: null, selectedId: null });
    const { config, customUniverse } = get();
    try {
      const result = await startSearch(config, customUniverse ?? undefined, (progress) =>
        set({ progress }),
      );
      const top = result.survivors[0]?.genome.id ?? null;
      set({ run: result, status: "done", selectedId: top });
      if (top) void get().select(top);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "cancelled") set({ status: "cancelled" });
      else set({ status: "error", error: message });
    }
  },

  cancel: () => {
    cancelSearch();
  },

  select: (id) => {
    set({ selectedId: id, inspection: null });
    if (!id) return;
    const { run, config, customUniverse } = get();
    const strategy = run?.survivors.find((s) => s.genome.id === id);
    if (!strategy) return;
    set({ inspecting: true });
    inspect(config, strategy.genome, customUniverse ?? undefined)
      .then((inspection) => {
        // A newer selection may have landed while this was in flight.
        if (get().selectedId === id) set({ inspection, inspecting: false });
      })
      .catch((error: Error) => set({ inspecting: false, error: error.message }));
  },

  refreshPreview: async () => {
    set({ previewLoading: true });
    try {
      const preview = await loadPreview(get().config, get().customUniverse ?? undefined);
      set({ preview, previewLoading: false });
    } catch (error) {
      set({
        previewLoading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  importCsv: (text, name) => {
    const report = parseCsvUniverse(text, name);
    if (!report.universe) {
      set({
        csvReport: { rowsKept: report.rowsKept, symbols: report.symbols, warnings: report.warnings },
        error: report.warnings[0] ?? "Could not read that CSV.",
      });
      return;
    }
    const plain = toPlainUniverse(report.universe);
    set((s) => ({
      customUniverse: plain,
      csvReport: {
        rowsKept: report.rowsKept,
        symbols: report.symbols,
        warnings: report.warnings,
      },
      error: null,
      config: { ...s.config, universeId: plain.id, symbols: report.symbols },
      preview: null,
      run: null,
      status: "idle",
    }));
    void get().refreshPreview();
  },

  clearCsv: () => {
    set((s) => ({
      customUniverse: null,
      csvReport: null,
      preview: null,
      run: null,
      status: "idle",
      config: { ...s.config, universeId: "synthetic", symbols: defaultConfig().symbols },
    }));
    void get().refreshPreview();
  },

  setEditorGenome: (genome) => set({ editorGenome: genome, editorResult: null }),

  patchEditorGenome: (patch) =>
    set((s) => (s.editorGenome ? { editorGenome: { ...s.editorGenome, ...patch } } : {})),

  evaluateEditor: async () => {
    const { editorGenome, config, customUniverse } = get();
    if (!editorGenome) return;
    set({ editorBusy: true });
    try {
      const editorResult = await evaluateGenome(config, editorGenome, customUniverse ?? undefined);
      set({ editorResult, editorBusy: false });
    } catch (error) {
      set({
        editorBusy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setClusterFilter: (clusterFilter) => set({ clusterFilter }),
  setFamilyFilter: (familyFilter) => set({ familyFilter }),
}));

export function useSelectedStrategy(): EvaluatedStrategy | null {
  return useLab((s) => s.run?.survivors.find((r) => r.genome.id === s.selectedId) ?? null);
}
