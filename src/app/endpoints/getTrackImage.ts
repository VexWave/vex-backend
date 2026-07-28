import type { AppRouteImplementation } from "@ts-rest/fastify";
import { db } from "../../db";
import { ApiContract } from "../../../contract/contract";

// Public, un-scoped read: track covers are served to anyone. Returns the raw
// cover bytes, or null when the track doesn't exist or has no cover.
async function getTrackCoverById(id: string): Promise<Buffer | null> {
  const row = await db.query.track.findFirst({
    columns: { cover: true },
    where: { id },
  });
  return row?.cover ?? null;
}

// Public route: track covers are served to anyone, no authorization required.
export const getTrackImage: AppRouteImplementation<
  typeof ApiContract.getTrackImage
> = async ({ params }) => {
  const cover = await getTrackCoverById(params.id);
  if (cover === null) {
    return { status: 404, body: "Track cover not found" };
  }

  return { status: 200, body: cover };
};
