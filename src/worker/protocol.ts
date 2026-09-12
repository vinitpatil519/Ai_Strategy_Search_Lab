import type { PlainUniverse } from "@/lib/engine/csv";
import type { ManualEvaluation, SearchProgress, StrategyInspection } from "@/lib/engine/search";
import type { Genome, SearchConfig, SearchRun } from "@/lib/engine/types";

export interface UniversePreview {
  id: string;
  label: string;
  dates: string[];
  benchmark: number[];
  regimePath: number[];
  regimeLabels: { label: string; tone: string; share: number; meanReturn: number; vol: number }[];
  series: {
    symbol: string;
    label: string;
    assetClass: string;
    close: number[];
    total: number;
    vol: number;
    maxDrawdown: number;
  }[];
}

export type WorkerRequest =
  | { type: "run"; requestId: number; config: SearchConfig; universe?: PlainUniverse }
  | { type: "cancel"; requestId: number }
  | { type: "inspect"; requestId: number; config: SearchConfig; genome: Genome; universe?: PlainUniverse }
  | { type: "evaluate"; requestId: number; config: SearchConfig; genome: Genome; universe?: PlainUniverse }
  | { type: "preview"; requestId: number; config: SearchConfig; universe?: PlainUniverse };

export type WorkerResponse =
  | { type: "progress"; requestId: number; payload: SearchProgress }
  | { type: "result"; requestId: number; payload: SearchRun }
  | { type: "inspection"; requestId: number; payload: StrategyInspection }
  | { type: "evaluation"; requestId: number; payload: ManualEvaluation }
  | { type: "preview"; requestId: number; payload: UniversePreview }
  | { type: "cancelled"; requestId: number }
  | { type: "error"; requestId: number; message: string };
