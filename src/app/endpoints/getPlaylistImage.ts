import type { AppRouteImplementation } from "@ts-rest/fastify";
import { db } from "../../db";
import { ApiContract } from "../../../contract/contract";

// Public, un-scoped read: playlist covers are served to anyone. Returns the raw
// image bytes, or null when the playlist doesn't exist or has no cover.
async function getPlaylistImageById(id: number): Promise<Buffer | null> {
  const row = await db.query.playlist.findFirst({
    columns: { image: true },
    where: { id },
  });
  return row?.image ?? null;
}

// Public route: playlist covers are served to anyone, no authorization required.
export const getPlaylistImage: AppRouteImplementation<
  typeof ApiContract.getPlaylistImage
> = async ({ params }) => {
  const image = await getPlaylistImageById(params.id);
  if (image === null) {
    return { status: 404, body: "Playlist image not found" };
  }

  return { status: 200, body: image };
};
