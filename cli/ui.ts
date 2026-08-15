// Shared presentation for the admin CLI: the prompt wrapper every prompt goes
// through, table rendering, and the value formatters the views share.

import { isCancel, unicodeOr } from "@clack/prompts";
import { clean } from "../src/logger";

/** Ctrl-C at a prompt. Caught only in `cli/index.ts`, which closes the pool. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

/**
 * Unwraps a prompt, turning clack's cancel symbol into a {@link Cancelled}.
 * Wrap every prompt in this so no caller has to carry a "cancelled" case.
 */
export async function ask<T>(answer: Promise<T | symbol>): Promise<T> {
  const value = await answer;
  if (isCancel(value)) {
    throw new Cancelled();
  }
  return value;
}

// --- Tables ---

export type Column<Row> = {
  header: string;
  value: (row: Row) => string;
  right?: boolean;
  /** Display-width cap; longer cells are truncated. */
  max?: number;
};

const DEFAULT_MAX = 40;

// Display width, not `.length`: a CJK character or emoji occupies two columns,
// and track titles come from users.
const width = (text: string): number => Bun.stringWidth(text);

function fit(text: string, max: number): string {
  if (width(text) <= max) {
    return text;
  }
  let out = "";
  for (const character of text) {
    if (width(out + character) > max - 1) {
      break;
    }
    out += character;
  }
  return `${out}…`;
}

/**
 * Aligned columns as one string, ready for clack's `note`.
 *
 * Cells go through `clean` (`src/logger.ts`) because titles and usernames are
 * user-supplied: an escape sequence in one would otherwise rewrite the
 * operator's terminal. Not `Bun.inspect.table`, which has no width cap and
 * prepends an index column.
 */
export function table<Row>(columns: Column<Row>[], rows: Row[]): string {
  const cells = rows.map((row) =>
    columns.map((column) =>
      fit(clean(column.value(row)), column.max ?? DEFAULT_MAX),
    ),
  );

  // Folded rather than spread into `Math.max`: a listing is one row per track,
  // and a long library would overflow the argument limit.
  const widths = columns.map((column, index) =>
    cells.reduce(
      (widest, cell) => Math.max(widest, width(cell[index] ?? "")),
      width(column.header),
    ),
  );

  const line = (values: string[]): string =>
    values
      .map((value, index) => {
        const pad = " ".repeat(
          Math.max(0, (widths[index] ?? 0) - width(value)),
        );
        return columns[index]?.right === true ? pad + value : value + pad;
      })
      .join("  ")
      .trimEnd();

  // clack's own fallback test, so the rule degrades to ASCII wherever its
  // glyphs do.
  const rule = unicodeOr("─", "-");

  return [
    line(columns.map((column) => column.header)),
    line(widths.map((each) => rule.repeat(each))),
    ...cells.map(line),
  ].join("\n");
}

// --- Formatters ---

const UNITS = ["KiB", "MiB", "GiB", "TiB"] as const;

export function bytes(count: number): string {
  if (count < 1024) {
    return `${count} B`;
  }
  let value = count / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** `mm:ss`, from a track's `durationMs`. */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * `YYYY-MM-DD` in the operator's local time.
 *
 * `createdAt` is `timestamp` without a zone, and postgres.js reads those bare
 * strings as UTC — so the `Date` is the right instant, and the local getters
 * below convert it to wherever the CLI is being run. Correct only while the
 * database's own `TimeZone` is UTC (it is): were it changed, these columns
 * would start storing a different zone's wall clock and every time shown here
 * would silently shift, since nothing in the value records which zone it is.
 */
export function date(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD HH:MM`, same clock as {@link date}. Not `toLocaleString`, whose
 * width and separators vary by locale and ICU build — a table column has to
 * measure the same on every machine.
 */
export function dateTime(at: Date): string {
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${date(at)} ${hours}:${minutes}`;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
