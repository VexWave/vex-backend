import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const deleteTrack: AppRouteImplementation<
  typeof ApiContract.deleteTrack
> = async ({ body, request }) => {
  const user = await UserManager.fromRequest(request);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const deleted = await user.deleteTrack(body.id);
  if (!deleted) {
    return { status: 404, body: "Track not found" };
  }

  return { status: 200, body: body.id };
};
