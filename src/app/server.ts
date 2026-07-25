import Fastify from "fastify";
import { initServer } from "@ts-rest/fastify";
import { ApiContract } from "../../contract/contract";
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
  bodyLimit: 100 * 1024 * 1024,
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

app.register(s.plugin(router));

const start = async () => {
  const port = 3700;
  try {
    await app.listen({ host: "0.0.0.0", port: port });
    console.log("Listening on port", port);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
