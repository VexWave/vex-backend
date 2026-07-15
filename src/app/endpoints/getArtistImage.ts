import type { AppRouteImplementation } from "@ts-rest/fastify";
import { db } from "../../db";
import { ApiContract } from "../../../contract/contract";

// Public, un-scoped read: artist images are served to anyone. Returns the raw
// image bytes, or null when the artist doesn't exist or has no image.
async function getArtistImageById(id: number): Promise<Buffer | null> {
  const row = await db.query.artist.findFirst({
    columns: { image: true },
    where: { id },
  });
  return row?.image ?? null;
}

// Public route: artist images are served to anyone, no authorization required.
export const getArtistImage: AppRouteImplementation<
  typeof ApiContract.getArtistImage
> = async ({ params }) => {
  const image = await getArtistImageById(params.id);
  if (image === null) {
    return { status: 404, body: "Artist image not found" };
  }

  return { status: 200, body: image };
};
