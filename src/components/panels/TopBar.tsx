"use client";

import { useEffect, useState } from "react";
import { duration, int } from "@/lib/format";
import { useLab, type TabId } from "@/lib/store";
import { Button, ProgressBar, cx } from "@/components/ui/primitives";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "clusters", label: "Clusters" },
  { id: "regimes", label: "Regimes" },
  { id: "strategy", label: "Strategy" },
  { id: "editor", label: "Editor" },
  { id: "data", label: "Data" },
];

export function TopBar({ onToggleRail, railOpen }: { onToggleRail: () => void; railOpen: boolean }) {
  const status = useLab((s) => s.status);
  const progress = useLab((s) => s.progress);
  const run = useLab((s) => s.run);
  const tab = useLab((s) => s.tab);
  const setTab = useLab((s) => s.setTab);
  const startRun = useLab((s) => s.startRun);
  const cancel = useLab((s) => s.cancel);
  const customUniverse = useLab((s) => s.customUniverse);
  const error = useLab((s) => s.error);

  const [elapsed, setElapsed] = useState(0);
  const running = status === "running";

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  const statusLabel =
    running
      ? progress?.message ?? "Working"
      : status === "done"
        ? "Run complete"
        : status === "cancelled"
          ? "Cancelled"
          : status === "error"
            ? error ?? "Failed"
            : "Ready";

  const statusTone =
    running
      ? "text-acid-400"
      : status === "error"
        ? "text-cherry-400"
        : status === "done"
          ? "text-ink-200"
          : "text-ink-400";

  return (
    <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-950/88 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <button
          type="button"
          onClick={onToggleRail}
          title={railOpen ? "Hide configuration" : "Show configuration"}
          className="flex h-7 w-7 items-center justify-center rounded border border-ink-700 text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 3.2h12M2 8h12M2 12.8h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <Mark />
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-semibold leading-tight tracking-tight text-ink-100">
              AI Strategy Search Lab
            </h1>
            <p className="truncate text-2xs leading-tight text-ink-500">
              {customUniverse ? `${customUniverse.label} · imported` : "Synthetic cross-asset universe"}
            </p>
          </div>
        </div>

        <div className="ml-2 hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <span className={cx("truncate font-mono text-2xs", statusTone)}>{statusLabel}</span>
          {running && (
            <div className="w-40 shrink-0">
              <ProgressBar value={progress?.progress ?? 0} />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3 font-mono text-2xs text-ink-500 tnum">
            {running && <span>{duration(elapsed)}</span>}
            {(running || run) && (
              <span>{`${int(progress?.evaluated ?? run?.evaluated ?? 0)} tested`}</span>
            )}
            {run && !running && (
              <span>{`${run.survivors.length} survivors`}</span>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button variant="danger" onClick={cancel}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                void startRun();
                setTab("overview");
              }}
            >
              {run ? "Run again" : "Run search"}
            </Button>
          )}
        </div>
      </div>

      <nav className="flex items-center gap-0.5 overflow-x-auto px-3">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cx(
                "relative whitespace-nowrap px-2.5 py-2 text-xs transition-colors duration-100",
                active ? "text-ink-100" : "text-ink-500 hover:text-ink-300",
              )}
            >
              {entry.label}
              <span
                className={cx(
                  "absolute inset-x-1.5 -bottom-px h-0.5 rounded-full transition-opacity duration-150",
                  active ? "bg-acid-500 opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </nav>
    </header>
  );
}

/** Wordmark glyph: a small search lattice that doubles as a candle chart. */
function Mark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded border border-ink-700 bg-ink-900">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="9" width="2" height="5" rx="0.6" fill="#35e0a1" />
        <rect x="5" y="5.5" width="2" height="8.5" rx="0.6" fill="#35e0a1" opacity="0.65" />
        <rect x="8.5" y="7" width="2" height="7" rx="0.6" fill="#6b8cff" opacity="0.8" />
        <circle cx="11.6" cy="4.4" r="3.1" stroke="#dfe4ea" strokeWidth="1.1" />
        <path d="M13.9 6.7 15 7.9" stroke="#dfe4ea" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </span>
  );
}
