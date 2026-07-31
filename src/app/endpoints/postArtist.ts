import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const postArtist: AppRouteImplementation<
  typeof ApiContract.postArtist
> = async ({ body, request }) => {
  const user = await UserManager.fromRequest(request);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { name, image } = body;

  const id = await user.createArtist({ name, image });
  if (id === null) {
    return { status: 500, body: "Failed to insert artist" };
  }

  return { status: 200, body: String(id) };
};
