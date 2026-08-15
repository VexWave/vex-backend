import Fastify from "fastify";
import { initServer } from "@ts-rest/fastify";
import { ApiContract } from "../../contract/contract";
import { flush } from "../discord";
import { env } from "../env";
import { events, notify } from "../events";
import {
  cacheHeaders,
  handleUncaughtError,
  limitRouteBodies,
  logRequests,
  rateLimit,
  requireAuth,
  securityHeaders,
  SMALL_BODY_LIMIT,
} from "./hooks";
import { login } from "./endpoints/login";
import { postArtist } from "./endpoints/postArtist";
import { postTrack } from "./endpoints/postTrack";
import { deleteTrack } from "./endpoints/deleteTrack";
import { deleteArtist } from "./endpoints/deleteArtist";
import { editTrack } from "./endpoints/editTrack";
import { editArtist } from "./endpoints/editArtist";
import { getTracks } from "./endpoints/getTracks";
import { getArtists } from "./endpoints/getArtists";
import { getArtistImage } from "./endpoints/getArtistImage";
import { getTrackImage } from "./endpoints/getTrackImage";
import { getTrackAudio } from "./endpoints/getTrackAudio";
import { postPlaylist } from "./endpoints/postPlaylist";
import { editPlaylist } from "./endpoints/editPlaylist";
import { deletePlaylist } from "./endpoints/deletePlaylist";
import { getPlaylists } from "./endpoints/getPlaylists";
import { getPlaylistImage } from "./endpoints/getPlaylistImage";

const app = Fastify({
  // Backstop only: `limitRouteBodies` gives each route its own ceiling, and
  // this is what anything outside the contract gets.
  bodyLimit: SMALL_BODY_LIMIT,
  // Decides whether `request.ip` — the key every rate limit is counted
  // against — comes from the socket or from `X-Forwarded-For`.
  trustProxy: env.TRUST_PROXY,
  // Fastify logs nothing itself: the `logRequests` hook below writes the one
  // line a request is worth, when the response is done and how it turned out is
  // known. Leaving Fastify's own logger off is also what makes the session
  // token unleakable here — its internals log the whole request object, headers
  // and all, and nothing of ours ever sees an object it didn't build.
  logger: false,
});

const s = initServer();

const router = s.router(ApiContract, {
  login,
  postArtist,
  postTrack,
  deleteTrack,
  deleteArtist,
  editTrack,
  editArtist,
  getTracks,
  getArtists,
  getArtistImage,
  getTrackImage,
  getTrackAudio,
  postPlaylist,
  editPlaylist,
  deletePlaylist,
  getPlaylists,
  getPlaylistImage,
});

// Registered on the root instance before the router: ts-rest sets its own
// error handler inside the plugin, and this is the parent it delegates to for
// everything that isn't a request validation failure.
app.setErrorHandler(handleUncaughtError);

// Declared up front so every request has the property from the start; the
// gate fills it in for routes that require a token, and the error handler
// leaves what it caught in the other for the log line to print.
app.decorateRequest("userId", undefined);
app.decorateRequest("logError", undefined);

// Hooks have to be in place before the routes are registered — `onRoute` fires
// as each route is added, and the rest are copied into the plugin's context at
// registration time.
app.addHook("onRoute", limitRouteBodies);
app.addHook("onRequest", securityHeaders);
app.addHook("onRequest", rateLimit);
app.addHook("onRequest", requireAuth);
app.addHook("onSend", cacheHeaders);
app.addHook("onResponse", logRequests);

app.register(s.plugin(router));

const start = async () => {
  try {
    // Every interface, always: inside a container anything else answers
    // nothing, and elsewhere the firewall is what decides who gets through.
    const address = await app.listen({ host: "0.0.0.0", port: env.PORT });
    notify(events.serverStarted({ address }));
  } catch (err) {
    notify(events.listenFailed({ err }));
    // Nothing has been served yet, so there is nothing to wait for but the
    // report itself — `process.exit` would otherwise kill the request carrying
    // it. Every exit below follows the same order: report, flush, exit.
    await flush(2_000);
    process.exit(1);
  }
};

start();

// Note for development: `bun --watch` restarts on every save, so with a
// webhook configured each save posts a stop and a start. Leave
// `DISCORD_WEBHOOK_URL` unset locally.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    notify(events.serverStopping({ signal }));
    // Lets requests in flight finish before the report goes out, so a shutdown
    // that took a while looks like one.
    await app.close();
    await flush(2_000);
    process.exit(0);
  });
}

// The two ways the process dies without anything else noticing. Both leave the
// runtime in a state that can't be trusted to keep serving, so the only thing
// left to do is say so and go — on a shorter deadline than a clean shutdown
// gets, for the same reason.
process.on("uncaughtException", async (err) => {
  notify(events.crashed({ kind: "uncaught exception", err }));
  await flush(1_500);
  process.exit(1);
});

process.on("unhandledRejection", async (err) => {
  notify(events.crashed({ kind: "unhandled rejection", err }));
  await flush(1_500);
  process.exit(1);
});
