import type { AppRoute } from "@ts-rest/core";
import type {
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
  onRouteHookHandler,
} from "fastify";
import {
  ApiContract,
  MAX_AUDIO_BASE64,
  MAX_IMAGE_BASE64,
  type RoutePolicy,
} from "../../contract/contract";
import { getUserIdFromToken } from "../auth";
import { RateLimiter } from "../rateLimit";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The caller resolved from the `authorization` header, set by
     * `requireAuth` and read by `UserManager.fromRequest`. Undefined on
     * public routes, which the gate lets through without a lookup.
     */
    userId?: number;
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
 * Applies the headers above, then the route's cache policy. Runs in
 * `onRequest` so the responses the pipeline produces itself — a 401 from the
 * gate below, a 413, a 429 — carry them too, not just the ones an endpoint
 * returns.
 */
export const securityHeaders: onRequestHookHandler = async (request, reply) => {
  reply.headers(BASE_SECURITY_HEADERS);

  const { cache } = policyOf(routeOf(request.routeOptions.config));
  if (cache === "shared") {
    return;
  }

  // Everything else is answered per session token — including `/login`, whose
  // body *is* the token. `Vary` keeps a cache from handing one user's reply to
  // the next; `no-store` keeps it from holding on to the reply at all.
  reply.header("vary", "Authorization");
  reply.header("cache-control", cache === "private" ? "private" : "no-store");
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
 */
export function handleUncaughtError(
  error: Error & { statusCode?: number },
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const status = error.statusCode ?? 500;

  if (status >= 500) {
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send("Internal Server Error");
  }

  // 4xx are raised by Fastify itself — unparseable JSON, a body over the
  // route's limit — and describe the request rather than the server.
  request.log.info({ err: error, status }, "request rejected");
  return reply.status(status).send(error.message);
}
