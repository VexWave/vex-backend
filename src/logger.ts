// The console log: one line per completed request, plus a badge line for each
// notable event. There are no levels — everything written here is worth seeing.
//
// Paths, usernames and track titles all reach this file and all three are
// supplied by whoever is talking to the API, so every string is stripped of
// control characters and capped before it is written: without that, a track
// named with an escape sequence could rewrite the operator's terminal.

// Off when the output isn't a terminal, so a log redirected to a file or
// collected by journald contains no escape sequences at all.
const coloured =
  process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const GREY = 90;
const RED = 31;
const GREEN = 32;
const YELLOW = 33;
const BLUE = 34;
const CYAN = 36;

/** Severity of a notable event. Picks a colour; it does not filter anything. */
export type Tone = "info" | "warn" | "error";

const TONE_COLOUR: Record<Tone, number> = {
  info: CYAN,
  warn: YELLOW,
  error: RED,
};

// Green for a success, yellow for something the caller got wrong, red for
// something the server got wrong — the split that decides whether a line is
// worth stopping on.
function statusColour(status: number): number {
  if (status >= 500) return RED;
  if (status >= 400) return YELLOW;
  if (status >= 300) return BLUE;
  return GREEN;
}

// Applied after padding, never before: the escape sequences are zero-width on
// screen but count towards `padEnd`, so colouring first would misalign every
// column by the length of the code.
function paint(text: string, colour: number): string {
  return coloured ? `\x1b[${colour}m${text}\x1b[0m` : text;
}

/** Drops control characters — escape sequences among them — and caps. */
export function clean(text: string, max = 200): string {
  const kept: string[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    // C0 and C1 controls, which is where the escape sequences live.
    if (code >= 0x20 && (code < 0x7f || code > 0x9f)) {
      kept.push(character);
    }
  }
  // Capped by code point rather than by `.length`: an astral character is two
  // UTF-16 units, and slicing between them leaves a lone surrogate.
  return kept.length > max
    ? `${kept.slice(0, max - 1).join("")}…`
    : kept.join("");
}

// Drizzle builds a failed query's message as `Failed query: <sql>\nparams:
// <values>` (`drizzle-orm/errors.js`), and on this server those values are
// routinely the session token the request arrived with — or, when a `session`
// insert is what failed, the one just minted. The SQL already says which lookup
// broke, so the parameters are dropped before anything can print or send them.
function withoutParams(message: string): string {
  const at = message.indexOf("\nparams:");
  return at === -1 ? message : message.slice(0, at);
}

/** An error's one-line description, for use as the reason on a 4xx line. */
export function messageOf(error: unknown): string | undefined {
  if (error === undefined || error === null) {
    return undefined;
  }
  if (error instanceof Error) {
    return withoutParams(error.message) || error.name;
  }
  // Deliberately `String` rather than a stringifier: an object renders as
  // `[object Object]`, which says nothing but also leaks nothing.
  return String(error);
}

/** `{ from: "1.2.3.4", id: 7 }` → `from=1.2.3.4 id=7`. Shared with Discord. */
export function renderFields(
  fields?: Record<string, string | number | undefined>,
): string | undefined {
  if (fields === undefined) {
    return undefined;
  }
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length === 0 ? undefined : parts.join(" ");
}

// `HH:MM:SS.mmm` plus the two spaces after it, so everything a line continues
// onto lines up under the first column of text rather than under the clock.
const INDENT = " ".repeat(14);
const FRAME_INDENT = " ".repeat(18);
const MAX_FRAMES = 6;

function stamp(): string {
  const at = new Date();
  const ms = String(at.getMilliseconds()).padStart(3, "0");
  return `${at.toTimeString().slice(0, 8)}.${ms}`;
}

// The indented block under a line: the error's description, the frames nearest
// the throw, and the message of one `cause` — a chain of wrapped driver errors
// runs deep, and the outermost cause is the one that names the failure.
function stackLines(error: unknown): string[] {
  if (!(error instanceof Error)) {
    const text = messageOf(error);
    return text === undefined ? [] : [INDENT + paint(clean(text, 300), RED)];
  }

  const lines = [
    INDENT +
      paint(clean(`${error.name}: ${withoutParams(error.message)}`, 300), RED),
  ];
  for (const frame of (error.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, MAX_FRAMES)) {
    lines.push(FRAME_INDENT + paint(clean(frame, 300), GREY));
  }

  const cause = messageOf(error.cause);
  if (cause !== undefined) {
    lines.push(INDENT + paint(clean(`caused by: ${cause}`, 300), GREY));
  }
  return lines;
}

// The one place anything is written. One `write` per entry, with the whole
// block built first: two writes would let a concurrent request's line land in
// the middle of an error's frames.
function emit(
  badge: string,
  colour: number,
  rest: string,
  err?: unknown,
): void {
  const lines = [
    paint(stamp(), GREY) +
      "  " +
      paint(clean(badge, 7).padEnd(7), colour) +
      rest,
  ];
  if (err !== undefined && err !== null) {
    lines.push(...stackLines(err));
  }
  process.stdout.write(lines.join("\n") + "\n");
}

/**
 * One line per completed request: method, status, duration, route, caller —
 * fixed columns, so a screenful of them can be read down rather than across.
 */
export function logRequest(entry: {
  method: string;
  status: number;
  ms: number;
  path: string;
  who: string;
  /** Short trailing reason, for a rejection the caller caused. */
  note?: string;
  /** Rendered as a stack block beneath the line. */
  err?: unknown;
}): void {
  const colour = statusColour(entry.status);
  const note = entry.note === undefined ? undefined : clean(entry.note);

  emit(
    entry.method,
    colour,
    paint(String(entry.status).padStart(3), colour) +
      paint(`${Math.max(0, entry.ms)}ms`.padStart(6), GREY) +
      "  " +
      clean(entry.path, 160).padEnd(24) +
      " " +
      paint(clean(entry.who, 48), GREY) +
      (note === undefined || note === "" ? "" : "  " + paint(note, GREY)),
    entry.err,
  );
}

/** A badge line for a notable event: `READY`, `AUTH`, `TRACK`, … */
export function logEvent(
  tone: Tone,
  tag: string,
  title: string,
  detail?: string,
  err?: unknown,
): void {
  emit(
    tag,
    TONE_COLOUR[tone],
    clean(title) +
      (detail === undefined ? "" : "  " + paint(clean(detail, 400), GREY)),
    err,
  );
}
