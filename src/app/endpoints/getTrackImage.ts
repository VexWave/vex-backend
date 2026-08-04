import type { AppRouteImplementation } from "@ts-rest/fastify";
import { db } from "../../db";
import { ApiContract } from "../../../contract/contract";
import { serveImage, toStoredImage, type StoredImage } from "../imageCache";

// Public, un-scoped read: track covers are served to anyone. Returns the
// stored bytes with the hash that versions them, or null when the track
// doesn't exist or has no cover.
async function getTrackCoverById(id: string): Promise<StoredImage | null> {
  const row = await db.query.track.findFirst({
    columns: { cover: true, coverHash: true },
    where: { id },
  });
  return row === undefined ? null : toStoredImage(row.cover, row.coverHash);
}

// Public route: track covers are served to anyone, no authorization required.
export const getTrackImage: AppRouteImplementation<
  typeof ApiContract.getTrackImage
> = async ({ params, query, request, reply }) => {
  const served = await serveImage({
    kind: "track",
    id: params.id,
    version: query.v,
    ifNoneMatch: request.headers["if-none-match"],
    reply,
    load: () => getTrackCoverById(params.id),
  });

  return served ?? { status: 404, body: "Track cover not found" };
};
