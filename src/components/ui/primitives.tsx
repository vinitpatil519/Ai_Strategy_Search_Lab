"use client";

import type { ReactNode } from "react";

/** Shared building blocks. Everything visual in the lab is composed from these
 *  so spacing, type scale and focus states stay identical across panels. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("panel flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {subtitle && <p className="panel-sub mt-0.5 truncate">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx("min-w-0 flex-1", bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  title,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = {
    sm: "h-6 px-2 text-2xs",
    md: "h-8 px-3 text-xs",
  };
  const variants = {
    primary: "bg-acid-500 text-ink-950 hover:bg-acid-400",
    ghost: "text-ink-200 hover:bg-ink-750 hover:text-ink-100",
    outline: "border border-ink-600 text-ink-200 hover:border-ink-500 hover:bg-ink-800",
    danger: "border border-cherry-600/60 text-cherry-400 hover:bg-cherry-600/15",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  );
}

export function Tag({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium",
        className,
      )}
      style={
        color
          ? { borderColor: `${color}55`, color, background: `${color}14` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color }}
    />
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  mono = true,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "accent";
  mono?: boolean;
}) {
  const tones = {
    neutral: "text-ink-100",
    good: "text-acid-400",
    bad: "text-cherry-400",
    accent: "text-iris-400",
  };
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className={cx("mt-1 text-[19px] leading-none tnum", mono && "font-mono", tones[tone])}>
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-2xs text-ink-400">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-md border border-ink-700 bg-ink-850 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cx(
            "rounded transition-colors duration-100",
            size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
            option.value === value
              ? "bg-ink-700 text-ink-100"
              : "text-ink-400 hover:text-ink-200",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (value: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="label">{label}</span>
        <span className="font-mono text-xs text-ink-100 tnum">{display ?? value}</span>
      </span>
      <input
        type="range"
        className="mt-2"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="mt-1 block text-2xs leading-snug text-ink-500">{hint}</span>}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-1.5 flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850 px-2 focus-within:border-ink-500">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="h-7 w-full bg-transparent font-mono text-xs text-ink-100 outline-none tnum"
        />
        {suffix && <span className="text-2xs text-ink-500">{suffix}</span>}
      </span>
    </label>
  );
}

export function Checklist<T extends string>({
  label,
  options,
  selected,
  onChange,
  colorFor,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  colorFor?: (value: T) => string;
}) {
  const toggle = (value: T) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    // Never allow an empty set: the search needs at least one option.
    onChange(next.length ? next : selected);
  };
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {options.map((option) => {
          const on = selected.includes(option.value);
          const color = colorFor?.(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded border px-1.5 py-1 text-2xs transition-colors duration-100",
                on
                  ? "border-ink-500 bg-ink-750 text-ink-100"
                  : "border-ink-700/70 text-ink-500 hover:border-ink-600 hover:text-ink-300",
              )}
            >
              {color && <Dot color={on ? color : "#3a4454"} size={6} />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ProgressBar({ value, tone = "acid" }: { value: number; tone?: "acid" | "iris" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-ink-750">
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-300 ease-out",
          tone === "acid" ? "bg-acid-500" : "bg-iris-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="h-8 w-8 rounded-full border border-dashed border-ink-600" />
      <h3 className="text-[13px] font-medium text-ink-200">{title}</h3>
      <p className="max-w-sm text-xs leading-relaxed text-ink-400">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-2xs text-ink-400">{label}</span>
      <span className="font-mono text-xs text-ink-100 tnum">{children}</span>
    </div>
  );
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <div className="my-3 border-t border-ink-700/60" />;
  return (
    <div className="my-3 flex items-center gap-2">
      <span className="label whitespace-nowrap">{label}</span>
      <span className="h-px flex-1 bg-ink-700/60" />
    </div>
  );
}

export function ScrollArea({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx("overflow-auto", className)}>{children}</div>;
}
