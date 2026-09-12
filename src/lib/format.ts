/** Display formatting. Kept in one place so every table, tile and tooltip
 *  renders the same number the same way. */

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "–";
  const s = (value * 100).toFixed(digits);
  return `${value > 0 ? "+" : ""}${s}%`;
}

export function num(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "–";
  return value.toFixed(digits);
}

export function signed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function int(value: number): string {
  if (!Number.isFinite(value)) return "–";
  return Math.round(value).toLocaleString("en-US");
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function shortDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function monthLabel(iso: string): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

export function yearOf(iso: string): string {
  return iso.slice(0, 4);
}

export function titleCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
