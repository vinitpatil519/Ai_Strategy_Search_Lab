"use client";

import { useEffect, useState } from "react";
import { ClusterPanel } from "@/components/panels/ClusterPanel";
import { ControlRail } from "@/components/panels/ControlRail";
import { DataPanel } from "@/components/panels/DataPanel";
import { EditorPanel } from "@/components/panels/EditorPanel";
import { LeaderboardPanel } from "@/components/panels/LeaderboardPanel";
import { OverviewPanel } from "@/components/panels/OverviewPanel";
import { RegimePanel } from "@/components/panels/RegimePanel";
import { StrategyPanel } from "@/components/panels/StrategyPanel";
import { TopBar } from "@/components/panels/TopBar";
import { cx } from "@/components/ui/primitives";
import { useLab } from "@/lib/store";

export default function LabPage() {
  const tab = useLab((s) => s.tab);
  const status = useLab((s) => s.status);
  const progress = useLab((s) => s.progress);
  const error = useLab((s) => s.error);
  const [railOpen, setRailOpen] = useState(true);

  // Keyboard shortcuts: numbers jump between tabs, R starts a run.
  const setTab = useLab((s) => s.setTab);
  const startRun = useLab((s) => s.startRun);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const tabs = [
        "overview",
        "leaderboard",
        "clusters",
        "regimes",
        "strategy",
        "editor",
        "data",
      ] as const;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < tabs.length) setTab(tabs[index]);
      if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) void startRun();
      if (event.key.toLowerCase() === "b") setRailOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab, startRun]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar onToggleRail={() => setRailOpen((open) => !open)} railOpen={railOpen} />

      <div className="flex min-h-0 flex-1">
        <div
          className={cx(
            "hidden shrink-0 border-r border-ink-700/70 bg-ink-900/40 transition-[width] duration-200 lg:block",
            railOpen ? "w-[286px]" : "w-0 overflow-hidden",
          )}
        >
          {railOpen && (
            <ControlRail className="h-[calc(100vh-5.75rem)] w-[286px] animate-fade-up" />
          )}
        </div>

        <main className="min-w-0 flex-1 p-3">
          {status === "error" && error && (
            <div className="mb-3 rounded-card border border-cherry-600/50 bg-cherry-600/10 px-4 py-3">
              <p className="text-xs text-cherry-400">{error}</p>
            </div>
          )}

          {status === "running" && (
            <div className="mb-3 flex items-center gap-3 rounded-card border border-ink-700/70 bg-ink-900/70 px-4 py-2.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acid-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-acid-500" />
              </span>
              <span className="font-mono text-2xs text-ink-300">
                {progress?.message ?? "Working"}
              </span>
              <span className="ml-auto font-mono text-2xs text-ink-500 tnum">
                {progress ? `${Math.round(progress.progress * 100)}%` : ""}
              </span>
            </div>
          )}

          <div key={tab} className="animate-fade-up">
            {tab === "overview" && <OverviewPanel />}
            {tab === "leaderboard" && <LeaderboardPanel />}
            {tab === "clusters" && <ClusterPanel />}
            {tab === "regimes" && <RegimePanel />}
            {tab === "strategy" && <StrategyPanel />}
            {tab === "editor" && <EditorPanel />}
            {tab === "data" && <DataPanel />}
          </div>

          <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2 text-2xs text-ink-600">
            <span>Algorithmic search, no language model in the loop.</span>
            <span className="font-mono">
              genetic search · vectorized backtester · Gaussian HMM · k-means · t-SNE
            </span>
            <span className="ml-auto font-mono">keys 1-7 tabs · R run · B rail</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
