import { env } from "./env";
import { logEvent, messageOf, renderFields } from "./logger";
import { tryCatch } from "./utils";
import type { NotableEvent } from "./events";

// Delivery of notable events to a Discord webhook. Nothing outside
// `src/events.ts` imports this.
//
// Two rules shape it. **A notification must never slow down or break a
// request**: `enqueue` does no I/O, it appends to an array and returns. And **a
// failing webhook must stay quiet**: batching, a queue ceiling and a latched
// warning are what stop an incident producing a second storm on top of itself.

// Absent means the feature is off. The env schema folds a blank value into
// `undefined`, so this is the only test anywhere.
const WEBHOOK = env.DISCORD_WEBHOOK_URL;

// How long events accumulate before a send. Also the coalescing window: this is
// the interval over which a storm collapses into one message. Discord allows
// ~30 requests a minute per webhook, and this keeps us to 30.
const INTERVAL_MS = 2_000;
const MAX_QUEUED = 100;
const TIMEOUT_MS = 5_000;

const COLOURS: Record<NotableEvent["tone"], number> = {
  info: 0x3ba55d,
  warn: 0xe5a800,
  error: 0xed4245,
};

const DESCRIPTION_LIMIT = 3_900; // Discord's own limit is 4096.

type Queued = { event: NotableEvent; count: number };

const queue: Queued[] = [];

// Events dropped because the queue was full, reported on the next message that
// gets through so a truncated picture never looks like a complete one.
let dropped = 0;

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> = Promise.resolve();
let failing = false;

/**
 * Accepts an event for delivery. Synchronous, allocation-cheap, and safe to
 * call from anywhere including an `uncaughtException` handler.
 *
 * Events carrying the same `key` collapse into one entry with a count, so the
 * same error repeated three hundred times arrives as a single line reading
 * `×300`.
 */
export function enqueue(event: NotableEvent): void {
  if (WEBHOOK === undefined) {
    return;
  }

  const same =
    event.key === undefined
      ? undefined
      : queue.find((entry) => entry.event.key === event.key);
  if (same !== undefined) {
    same.count += 1;
    return;
  }

  // The newest is what's dropped: during an incident the first events are the
  // ones that explain it, and the rest are the same thing again.
  if (queue.length >= MAX_QUEUED) {
    dropped += 1;
    return;
  }

  queue.push({ event, count: 1 });
  timer ??= setTimeout(() => {
    timer = undefined;
    pending = send();
  }, INTERVAL_MS);
}

/**
 * Sends whatever is queued and waits for it, up to `deadlineMs`.
 *
 * Needed before `process.exit`, which does not wait for pending I/O — without
 * this, the notification about a crash is killed by the very exit it is
 * reporting. The deadline is what stops a hung webhook holding a shutdown open.
 */
export async function flush(deadlineMs = 2_000): Promise<void> {
  if (WEBHOOK === undefined) {
    return;
  }

  clearTimeout(timer);
  timer = undefined;
  // Chained rather than called, so a send already in flight finishes first and
  // two batches can never race each other to the webhook.
  pending = pending.then(send);

  await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(resolve, deadlineMs)),
  ]);
}

// Never throws: a rejection here would reach the crash handler, which would try
// to report it through this very queue.
async function send(): Promise<void> {
  const batch = queue.splice(0, queue.length);
  const missed = dropped;
  dropped = 0;

  if (WEBHOOK === undefined || batch.length === 0) {
    return;
  }

  const [response, failure] = await tryCatch(
    fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadFor(batch, missed)),
      // Without a deadline a stalled connection would hold the whole queue.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );

  if (failure !== null) {
    failed(failure.message);
  } else if (!response.ok) {
    // Includes a 429: the batching window above already keeps us inside
    // Discord's budget, so being refused means something else is wrong and
    // stacking retries during an incident is how a queue never empties.
    failed(`http ${response.status}`);
  } else {
    failing = false;
  }
}

function payloadFor(batch: Queued[], missed: number): unknown {
  const tone = batch.some((entry) => entry.event.tone === "error")
    ? "error"
    : batch.some((entry) => entry.event.tone === "warn")
      ? "warn"
      : "info";

  const lines = batch.map(({ event, count }) => {
    const head = `**${event.tag}** ${event.title}${count > 1 ? ` \`×${count}\`` : ""}`;
    const reason = messageOf(event.err);
    const detail = [
      renderFields(event.fields),
      reason === undefined ? undefined : `error: ${reason}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" ");
    return detail === "" ? head : `${head}\n${detail}`;
  });

  if (missed > 0) {
    lines.push(`_… and ${missed} more suppressed_`);
  }

  let description = lines.join("\n\n");
  if (description.length > DESCRIPTION_LIMIT) {
    description = `${description.slice(0, DESCRIPTION_LIMIT)}\n… (truncated)`;
  }

  return {
    embeds: [
      {
        description,
        color: COLOURS[tone],
        timestamp: new Date().toISOString(),
      },
    ],
    // Track titles, usernames and request paths all end up in the text above,
    // and all three are supplied by whoever is talking to the API. Without
    // this, uploading a track called `@everyone` pings the whole server.
    allowed_mentions: { parse: [] },
  };
}

// One warning when the webhook starts failing and nothing until it works
// again. A broken webhook must not become a second log storm.
function failed(reason: string): void {
  if (failing) {
    return;
  }
  failing = true;
  logEvent(
    "warn",
    "HOOK",
    `discord webhook failing (${reason}) — silent until it works again`,
  );
}
