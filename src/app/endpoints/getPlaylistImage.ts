import type { AppRouteImplementation } from "@ts-rest/fastify";
import { db } from "../../db";
import { ApiContract } from "../../../contract/contract";
import { serveImage, toStoredImage, type StoredImage } from "../imageCache";

// Public, un-scoped read: playlist covers are served to anyone. Returns the
// stored bytes with the hash that versions them, or null when the playlist
// doesn't exist or has no cover.
async function getPlaylistImageById(id: number): Promise<StoredImage | null> {
  const row = await db.query.playlist.findFirst({
    columns: { image: true, imageHash: true },
    where: { id },
  });
  return row === undefined ? null : toStoredImage(row.image, row.imageHash);
}

// Public route: playlist covers are served to anyone, no authorization required.
export const getPlaylistImage: AppRouteImplementation<
  typeof ApiContract.getPlaylistImage
> = async ({ params, query, request, reply }) => {
  const served = await serveImage({
    kind: "playlist",
    id: params.id,
    version: query.v,
    ifNoneMatch: request.headers["if-none-match"],
    reply,
    load: () => getPlaylistImageById(params.id),
  });

  return served ?? { status: 404, body: "Playlist image not found" };
};
