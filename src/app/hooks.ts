import type { AppRoute } from "@ts-rest/core";
import type {
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
  onResponseHookHandler,
  onRouteHookHandler,
  onSendHookHandler,
} from "fastify";
import {
  ApiContract,
  MAX_AUDIO_BASE64,
  MAX_IMAGE_BASE64,
  type RoutePolicy,
} from "../../contract/contract";
import { getUserIdFromToken } from "../auth";
import { events, notify } from "../events";
import { logRequest, messageOf } from "../logger";
import { RateLimiter } from "../rateLimit";
import { NO_STORE, PRIVATE_FOREVER } from "./cacheControl";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The caller resolved from the `authorization` header, set by
     * `requireAuth` and read by `UserManager.fromRequest`. Undefined on
     * public routes, which the gate lets through without a lookup.
     */
    userId?: number;
    /**
     * What `handleUncaughtError` caught, left here for `logRequests` to print
     * once the response is finished. See that handler for why it isn't logged
     * where it is caught.
     */
    logError?: Error;
  }
}

// The contract entry Fastify matched, or undefined when the request didn't hit
// a contract route at all (404s). ts-rest stashes it in the route's context
// config as it registers each route.
function routeOf(config: unknown): AppRoute | undefined {
  return (config as { tsRestRoute?: AppRoute } | undefined)?.tsRestRoute;
}

// What the contract says about how to treat a route (see `RoutePolicy` there
// for the fields and their defaults). An unclassified route gets the empty
// policy, and every default is the restrictive one, so forgetting to classify
// a new route fails closed.
const DEFAULT_POLICY: RoutePolicy = {};

function policyOf(route: AppRoute | undefined): RoutePolicy {
  return (route?.metadata as RoutePolicy | undefined) ?? DEFAULT_POLICY;
}

// ---------------------------------------------------------------------------
// Per-route body ceilings
// ---------------------------------------------------------------------------

// What a request is allowed to carry beyond a media payload: ids, names, and
// the JSON envelope around them. Media routes get this on top of their payload
// allowance, so an upload the contract's schema accepts still fits inside the
// ceiling rather than being cut off before validation sees it.
export const SMALL_BODY_LIMIT = 512 * 1024;

const MEDIA_BODY_LIMITS: Record<NonNullable<RoutePolicy["body"]>, number> = {
  image: MAX_IMAGE_BASE64 + SMALL_BODY_LIMIT,
  // The audio class is `postTrack`, and its body carries a cover image next to
  // the audio — so the ceiling has to cover both payloads at once, or a track
  // uploaded with a large cover is refused before the schema ever sees it.
  audio: MAX_AUDIO_BASE64 + MAX_IMAGE_BASE64 + SMALL_BODY_LIMIT,
};

/**
 * Gives every route its own body ceiling instead of letting them all inherit
 * the largest one the server needs. Without it, a request to any route — say
 * `/login`, which is reachable without a token — could make Fastify buffer the
 * 100 MiB a track upload is allowed.
 *
 * Fastify reads `bodyLimit` off the route options right after `onRoute` hooks
 * run, which is the only seam ts-rest leaves for setting it per route.
 */
export const limitRouteBodies: onRouteHookHandler = (routeOptions) => {
  const { body } = policyOf(routeOf(routeOptions.config));
  routeOptions.bodyLimit =
    body === undefined ? SMALL_BODY_LIMIT : MEDIA_BODY_LIMITS[body];
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

// A blanket ceiling per source address. Set high enough that a client seeking
// around a track (each seek is its own ranged request) never notices it, and
// low enough to blunt a flood from a single host.
const requestsPerAddress = new RateLimiter(600, 60_000);

// The stricter budgets, one limiter per route that asked for one. Built from
// the contract at startup so a route's throttle is declared next to the route
// rather than named here.
const throttlesPerAddress = new Map<AppRoute, RateLimiter>();
for (const route of Object.values(ApiContract)) {
  const { throttle } = policyOf(route);
  if (throttle !== undefined) {
    throttlesPerAddress.set(route, new RateLimiter(...throttle));
  }
}

/**
 * Rejects callers that exceed their request budget. Runs in `onRequest`, so a
 * throttled client is turned away before the body is read.
 */
export const rateLimit: onRequestHookHandler = async (request, reply) => {
  const overall = requestsPerAddress.hit(request.ip);

  // Counted even when the blanket limit already tripped, so that hammering the
  // server doesn't hide attempts from the stricter budget.
  const route = routeOf(request.routeOptions.config);
  const throttled =
    route === undefined
      ? null
      : (throttlesPerAddress.get(route)?.hit(request.ip) ?? null);

  const retryAfter = throttled ?? overall;
  if (retryAfter !== null) {
    // One of only two places a 429 is produced (the other is `login`, for its
    // per-account budget), and both already hold the context the report wants
    // — so nothing downstream has to work out what happened from a status code.
    notify(
      events.rateLimited({
        path: request.routeOptions.url ?? request.url,
        ip: request.ip,
      }),
    );
    reply.header("retry-after", String(retryAfter));
    return reply.status(429).send("Too many requests");
  }
};

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

const BASE_SECURITY_HEADERS = {
  // Stored images and audio are attacker-controlled bytes served from this
  // origin. `nosniff` is what stops a browser from deciding an "image" is
  // really HTML and running its scripts here.
  "x-content-type-options": "nosniff",
  // Nothing this API returns is a document: it should never be framed, and it
  // has no business loading a subresource of any kind.
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; sandbox",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
} as const;

/**
 * Applies the headers above, then the `Vary` a per-caller answer needs. Runs
 * in `onRequest` so the responses the pipeline produces itself — a 401 from
 * the gate below, a 413, a 429 — carry them too, not just the ones an endpoint
 * returns.
 */
export const securityHeaders: onRequestHookHandler = async (request, reply) => {
  reply.headers(BASE_SECURITY_HEADERS);

  const { cache } = policyOf(routeOf(request.routeOptions.config));

  // Public versioned bytes are the same for every caller, so they carry no
  // `Vary`. Everything else is answered per session token — including
  // `/login`, whose body *is* the token — and `Vary` is what keeps a cache
  // from handing one user's reply to the next.
  if (cache !== "versioned") {
    reply.header("vary", "Authorization");
  }
};

/**
 * Applies the route's caching promise. Runs in `onSend` because that is the
 * first point that knows what the answer turned out to be — and the promise a
 * route makes about its bytes must not be inherited by its failures: on a
 * route whose successes may be kept for a year, a `404` kept for a year means
 * an image deleted and later restored byte-for-byte goes on being "not found",
 * and a `401` outlives the session that caused it.
 *
 * A `304` is not a failure: it is how a caller revalidates a copy it already
 * holds, and it has to carry the freshness headers that copy is updated with.
 *
 * Successes on a `"versioned"` route are the one case left alone, because only
 * `serveImage` knows whether the version the URL pinned is the one being
 * served; it sets the header itself.
 */
export const cacheHeaders: onSendHookHandler = async (
  request,
  reply,
  payload,
) => {
  const { cache } = policyOf(routeOf(request.routeOptions.config));

  if (reply.statusCode >= 400) {
    reply.header("cache-control", NO_STORE);
  } else if (cache !== "versioned") {
    reply.header(
      "cache-control",
      cache === "private-immutable" ? PRIVATE_FOREVER : NO_STORE,
    );
  }
  return payload;
};

// ---------------------------------------------------------------------------
// Authentication gate
// ---------------------------------------------------------------------------

/**
 * Turns unauthenticated callers away in `onRequest` — before Fastify parses a
 * body — so an anonymous client can't get the server to buffer and decode a
 * multi-megabyte upload just to be told "401" afterwards.
 *
 * The resolved id is left on the request for `UserManager.fromRequest`, so the
 * session lookup happens once per request rather than again in every endpoint.
 */
export const requireAuth: onRequestHookHandler = async (request, reply) => {
  const route = routeOf(request.routeOptions.config);
  // No contract route matched: leave it to Fastify's 404 rather than masking
  // an unknown path behind a 401.
  if (route === undefined || policyOf(route).public === true) {
    return;
  }

  const userId = await getUserIdFromToken(request.headers.authorization);
  if (userId === null) {
    return reply.status(401).send("Unauthorized");
  }
  request.userId = userId;
};

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Root error handler.
 *
 * ts-rest installs its own handler inside the plugin, which answers request
 * validation failures itself and hands everything else to `reply.send(err)` —
 * that delegates up the error-handler chain and lands here, which is why this
 * is registered on the root instance before the plugin.
 *
 * Anything from 500 up is reported as a bare "Internal Server Error": those
 * errors carry driver text, and a Postgres message names tables, columns and
 * constraints. Only the log gets to see it.
 *
 * The error is stashed rather than logged. This runs before the response is
 * finished, and the log line for the request is written after it — printing
 * here would put the stack above the line it belongs to instead of under it.
 * `logRequests` picks it up and is the only thing that prints it.
 */
export function handleUncaughtError(
  error: Error & { statusCode?: number },
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const status = error.statusCode ?? 500;
  request.logError = error;

  if (status >= 500) {
    return reply.status(500).send("Internal Server Error");
  }

  // 4xx are raised by Fastify itself — unparseable JSON, a body over the
  // route's limit — and describe the request rather than the server.
  return reply.status(status).send(error.message);
}

// ---------------------------------------------------------------------------
// Request log
// ---------------------------------------------------------------------------

/**
 * The one line each request leaves behind, and the only place an error is
 * printed. Fastify's own logging is off (`logger: false` in `server.ts`); this
 * hook replaces it, and registering it is also what keeps `reply.elapsedTime`
 * measured at all.
 */
export const logRequests: onResponseHookHandler = async (request, reply) => {
  const status = reply.statusCode;
  // The registered route pattern when one matched (`/artist/:id/image`), which
  // keeps a route's lines identical whatever ids they carry. A 404 has no
  // pattern, so it falls back to what was asked for — attacker-controlled text,
  // which the logger scrubs and caps before it reaches a terminal.
  const path = request.routeOptions.url ?? request.url;
  const failure = request.logError;

  logRequest({
    method: request.method,
    status,
    ms: Math.round(reply.elapsedTime),
    path,
    who:
      request.userId === undefined ? `ip:${request.ip}` : `u:${request.userId}`,
    // Below 500 the reason fits on the line — "Body too large", "Unexpected
    // token in JSON". At 500 and above it becomes the stack block, because the
    // message alone never explains a server fault.
    note: status >= 500 ? undefined : messageOf(failure),
    err: status >= 500 ? failure : undefined,
  });

  if (status >= 500) {
    // Keyed on the status rather than on a throw: an endpoint can *return*
    // `{ status: 500 }` without anything being thrown — see `postTrack` — and
    // the error handler never sees those.
    notify(
      events.serverError({
        method: request.method,
        path,
        userId: request.userId,
        ip: request.ip,
        err: failure,
      }),
    );
  }
};
