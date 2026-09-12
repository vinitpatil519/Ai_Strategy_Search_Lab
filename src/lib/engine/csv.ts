import { equalWeightIndex } from "./market";
import type { Series, Universe } from "./types";

/**
 * CSV ingest for real price history.
 *
 * Accepts either a single-instrument file or a long-format file with a symbol
 * column. Header detection is case-insensitive and tolerant of the usual
 * vendor spellings (Date/Timestamp, Adj Close/Close, Vol/Volume). Rows with an
 * unparseable date or close are skipped rather than poisoning the series.
 */

export interface CsvParseReport {
  universe: Universe | null;
  rowsRead: number;
  rowsKept: number;
  symbols: string[];
  warnings: string[];
}

const DATE_KEYS = ["date", "timestamp", "time", "datetime"];
const SYMBOL_KEYS = ["symbol", "ticker", "asset", "instrument", "name"];
const CLOSE_KEYS = ["close", "adj close", "adj_close", "adjclose", "last", "price"];
const OPEN_KEYS = ["open", "o"];
const HIGH_KEYS = ["high", "h"];
const LOW_KEYS = ["low", "l"];
const VOLUME_KEYS = ["volume", "vol", "qty"];

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if ((ch === "," || ch === ";" || ch === "\t") && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function findIndex(header: string[], keys: string[]): number {
  for (const key of keys) {
    const idx = header.findIndex((h) => h === key);
    if (idx >= 0) return idx;
  }
  for (const key of keys) {
    const idx = header.findIndex((h) => h.includes(key));
    if (idx >= 0) return idx;
  }
  return -1;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function num(raw: string): number {
  const v = Number(String(raw).replace(/[$,%\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : Number.NaN;
}

export function parseCsvUniverse(text: string, label = "Imported CSV"): CsvParseReport {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3) {
    return { universe: null, rowsRead: 0, rowsKept: 0, symbols: [], warnings: ["File has too few rows."] };
  }

  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const di = findIndex(header, DATE_KEYS);
  const ci = findIndex(header, CLOSE_KEYS);
  if (di < 0 || ci < 0) {
    return {
      universe: null,
      rowsRead: lines.length - 1,
      rowsKept: 0,
      symbols: [],
      warnings: ["Could not find a date column and a close column in the header row."],
    };
  }
  const si = findIndex(header, SYMBOL_KEYS);
  const oi = findIndex(header, OPEN_KEYS);
  const hi = findIndex(header, HIGH_KEYS);
  const li = findIndex(header, LOW_KEYS);
  const vi = findIndex(header, VOLUME_KEYS);

  interface Row {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }
  const bySymbol = new Map<string, Map<string, Row>>();
  let rowsRead = 0;
  let rowsKept = 0;

  for (let i = 1; i < lines.length; i++) {
    rowsRead++;
    const cells = splitLine(lines[i]);
    const date = normalizeDate(cells[di] ?? "");
    const close = num(cells[ci] ?? "");
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    const symbol = (si >= 0 ? cells[si] : "IMPORT").toUpperCase().slice(0, 12) || "IMPORT";
    const open = oi >= 0 ? num(cells[oi]) : Number.NaN;
    const high = hi >= 0 ? num(cells[hi]) : Number.NaN;
    const low = li >= 0 ? num(cells[li]) : Number.NaN;
    const volume = vi >= 0 ? num(cells[vi]) : Number.NaN;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, new Map());
    bySymbol.get(symbol)!.set(date, {
      date,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : Math.max(close, Number.isFinite(open) ? open : close),
      low: Number.isFinite(low) ? low : Math.min(close, Number.isFinite(open) ? open : close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
    rowsKept++;
  }

  if (bySymbol.size === 0) {
    return { universe: null, rowsRead, rowsKept, symbols: [], warnings: ["No usable rows found."] };
  }

  // Intersect dates so every series shares one calendar.
  let common: string[] | null = null;
  for (const rows of bySymbol.values()) {
    const dates = [...rows.keys()].sort();
    common = common === null ? dates : common.filter((d) => rows.has(d));
  }
  const dates = (common ?? []).sort();
  if (dates.length < 400) {
    warnings.push(
      `Only ${dates.length} overlapping bars across ${bySymbol.size} symbol(s). The search needs at least ~400 to be meaningful.`,
    );
  }
  if (dates.length < 300) {
    return { universe: null, rowsRead, rowsKept, symbols: [...bySymbol.keys()], warnings };
  }

  const series: Series[] = [...bySymbol.entries()].map(([symbol, rows]) => {
    const n = dates.length;
    const open = new Float64Array(n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const close = new Float64Array(n);
    const volume = new Float64Array(n);
    dates.forEach((d, i) => {
      const r = rows.get(d)!;
      open[i] = r.open;
      high[i] = r.high;
      low[i] = r.low;
      close[i] = r.close;
      volume[i] = r.volume;
    });
    return { symbol, label: symbol, assetClass: "Imported", dates, open, high, low, close, volume };
  });

  return {
    universe: {
      id: `csv-${dates[0]}-${dates[dates.length - 1]}-${series.length}`,
      label,
      dates,
      series,
      benchmark: equalWeightIndex(series),
    },
    rowsRead,
    rowsKept,
    symbols: series.map((s) => s.symbol),
    warnings,
  };
}

/** Structured clone of a universe cannot carry typed arrays through JSON, so
 *  the UI passes them to the worker in this plain shape. */
export interface PlainUniverse {
  id: string;
  label: string;
  dates: string[];
  series: {
    symbol: string;
    label: string;
    assetClass: string;
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  }[];
}

export function toPlainUniverse(u: Universe): PlainUniverse {
  return {
    id: u.id,
    label: u.label,
    dates: u.dates,
    series: u.series.map((s) => ({
      symbol: s.symbol,
      label: s.label,
      assetClass: s.assetClass,
      open: Array.from(s.open),
      high: Array.from(s.high),
      low: Array.from(s.low),
      close: Array.from(s.close),
      volume: Array.from(s.volume),
    })),
  };
}

export function fromPlainUniverse(p: PlainUniverse): Universe {
  const series: Series[] = p.series.map((s) => ({
    symbol: s.symbol,
    label: s.label,
    assetClass: s.assetClass,
    dates: p.dates,
    open: Float64Array.from(s.open),
    high: Float64Array.from(s.high),
    low: Float64Array.from(s.low),
    close: Float64Array.from(s.close),
    volume: Float64Array.from(s.volume),
  }));
  return { id: p.id, label: p.label, dates: p.dates, series, benchmark: equalWeightIndex(series) };
}
