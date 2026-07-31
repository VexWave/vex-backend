import Fastify from "fastify";
import { initServer } from "@ts-rest/fastify";
import { ApiContract } from "../../contract/contract";
import { env } from "../env";
import {
  handleUncaughtError,
  limitRouteBodies,
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
  logger: {
    level: "info",
    // Fastify's default request serializer logs no headers, but anything that
    // logs a request object wholesale must not spill the session token.
    redact: ["req.headers.authorization", "request.headers.authorization"],
  },
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
// gate fills it in for routes that require a token.
app.decorateRequest("userId", undefined);

// Hooks have to be in place before the routes are registered — `onRoute` fires
// as each route is added, and the rest are copied into the plugin's context at
// registration time.
app.addHook("onRoute", limitRouteBodies);
app.addHook("onRequest", securityHeaders);
app.addHook("onRequest", rateLimit);
app.addHook("onRequest", requireAuth);

app.register(s.plugin(router));

const start = async () => {
  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    console.log("Listening on port", env.PORT);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
