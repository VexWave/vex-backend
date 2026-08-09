import { enqueue } from "./discord";
import { logEvent, renderFields, type Tone } from "./logger";

// The notable events — everything worth telling someone about, as opposed to
// the request-by-request traffic the log already carries.
//
// **This is the file to edit to add or remove one.** An event is one entry in
// the catalogue below plus one call to `notify` where it happens. Every event
// goes to the console, and additionally to Discord when a webhook is
// configured, which is the only thing `DISCORD_WEBHOOK_URL` decides.

export type NotableEvent = {
  /** Console colour and Discord embed colour. Not a log level; nothing filters. */
  tone: Tone;
  /** Badge in the log's first column. Short and uppercase — 7 characters fit. */
  tag: string;
  title: string;
  /** Rendered as `key=value` on both destinations. */
  fields?: Record<string, string | number | undefined>;
  err?: unknown;
  /** `false` when the console already shows this another way. */
  console?: false;
  /**
   * Repeats sharing a key collapse into a single Discord line with a count.
   * Give one to anything an attacker or a broken client can trigger in a loop.
   */
  key?: string;
};

export const events = {
  // --- Lifecycle ---

  serverStarted: (a: { address: string }) => ({
    tone: "info",
    tag: "READY",
    title: `listening on ${a.address}`,
  }),

  serverStopping: (a: { signal: string }) => ({
    tone: "info",
    tag: "STOP",
    title: `shutting down on ${a.signal}`,
  }),

  listenFailed: (a: { err: unknown }) => ({
    tone: "error",
    tag: "FATAL",
    title: "could not start listening",
    err: a.err,
  }),

  crashed: (a: { kind: string; err: unknown }) => ({
    tone: "error",
    tag: "FATAL",
    title: a.kind,
    err: a.err,
  }),

  // --- Failures ---

  serverError: (a: {
    method: string;
    path: string;
    userId?: number;
    ip: string;
    err?: unknown;
  }) => ({
    tone: "error",
    tag: "5XX",
    title: `${a.method} ${a.path} failed`,
    fields: { user: a.userId, from: a.ip },
    err: a.err,
    // The request line has already printed this, stack and all, underneath the
    // response it belongs to.
    console: false as const,
    key: `5xx:${a.method}:${a.path}`,
  }),

  // --- Security ---

  // Only the address, no user: the limiter runs in `onRequest` ahead of the
  // auth gate, so at that moment nobody has been identified yet.
  rateLimited: (a: { path: string; ip: string }) => ({
    tone: "warn",
    tag: "LIMIT",
    title: `rate limited ${a.path}`,
    fields: { from: a.ip },
    key: `limit:${a.ip}`,
  }),

  loginThrottled: (a: { username: string; ip: string }) => ({
    tone: "warn",
    tag: "LIMIT",
    title: "login attempts throttled",
    fields: { account: a.username, from: a.ip },
    key: `throttle:${a.username}`,
  }),

  // The account is whatever was typed, so this can name one that doesn't
  // exist — which is exactly the shape an enumeration attempt has.
  loginFailed: (a: { username: string; ip: string }) => ({
    tone: "warn",
    tag: "AUTH",
    title: "failed login",
    fields: { account: a.username, from: a.ip },
    key: `login-fail:${a.username}`,
  }),

  loginSucceeded: (a: { username: string; ip: string }) => ({
    tone: "info",
    tag: "AUTH",
    title: `${a.username} signed in`,
    fields: { from: a.ip },
  }),

  // --- Library ---

  trackUploaded: (a: { userId: number; trackId: string; title: string }) => ({
    tone: "info",
    tag: "TRACK",
    title: `uploaded "${a.title}"`,
    fields: { user: a.userId, id: a.trackId },
  }),

  trackDeleted: (a: { userId: number; trackId: string }) => ({
    tone: "info",
    tag: "TRACK",
    title: "deleted a track",
    fields: { user: a.userId, id: a.trackId },
  }),
} satisfies Record<string, (...args: never[]) => NotableEvent>;

/**
 * Reports an event: to the console now, and to Discord shortly.
 *
 * Synchronous and never throws — neither half does any I/O of its own — which
 * is what makes it safe to drop into `login`, whose two failure branches have
 * to stay indistinguishable in the time they take, and into a crash handler.
 */
export function notify(event: NotableEvent): void {
  if (event.console !== false) {
    logEvent(
      event.tone,
      event.tag,
      event.title,
      renderFields(event.fields),
      event.err,
    );
  }
  enqueue(event);
}
