import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const editTrack: AppRouteImplementation<
  typeof ApiContract.editTrack
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { id, title, cover, artistIds } = body;

  if (title === undefined && cover === undefined && artistIds === undefined) {
    return { status: 400, body: "Nothing to update" };
  }

  const result = await user.updateTrack(id, { title, cover, artistIds });
  if (result === "not_found") {
    return { status: 404, body: "Track not found" };
  }
  if (result === "invalid_artists") {
    return { status: 400, body: "One or more artist ids are invalid" };
  }

  return { status: 200, body: id };
};
