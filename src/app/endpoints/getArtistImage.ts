import type { AppRouteImplementation } from "@ts-rest/fastify";
import { db } from "../../db";
import { ApiContract } from "../../../contract/contract";
import { serveImage, toStoredImage, type StoredImage } from "../imageCache";

// Public, un-scoped read: artist images are served to anyone. Returns the
// stored bytes with the hash that versions them, or null when the artist
// doesn't exist or has no image.
async function getArtistImageById(id: number): Promise<StoredImage | null> {
  const row = await db.query.artist.findFirst({
    columns: { image: true, imageHash: true },
    where: { id },
  });
  return row === undefined ? null : toStoredImage(row.image, row.imageHash);
}

// Public route: artist images are served to anyone, no authorization required.
export const getArtistImage: AppRouteImplementation<
  typeof ApiContract.getArtistImage
> = async ({ params, query, request, reply }) => {
  const served = await serveImage({
    kind: "artist",
    id: params.id,
    version: query.v,
    ifNoneMatch: request.headers["if-none-match"],
    reply,
    load: () => getArtistImageById(params.id),
  });

  return served ?? { status: 404, body: "Artist image not found" };
};
