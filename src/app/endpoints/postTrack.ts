import type { AppRouteImplementation } from "@ts-rest/fastify";
import { events, notify } from "../../events";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const postTrack: AppRouteImplementation<
  typeof ApiContract.postTrack
> = async ({ body, request }) => {
  const user = await UserManager.fromRequest(request);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { title, duration, data, cover, artistIds } = body;

  const id = await user.createTrack({
    title,
    durationMs: duration,
    data,
    cover,
    artistIds,
  });
  if (id === "invalid_artists") {
    return { status: 400, body: "One or more artist ids are invalid" };
  }
  if (id === null) {
    return { status: 500, body: "Failed to upload track" };
  }

  notify(events.trackUploaded({ userId: user.userId, trackId: id, title }));

  return { status: 200, body: id };
};
