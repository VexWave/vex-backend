import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const postArtist: AppRouteImplementation<
  typeof ApiContract.postArtist
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { name, imageUrl } = body;

  const id = await user.createArtist({ name, imageUrl });
  if (id === null) {
    return { status: 500, body: "Failed to insert artist" };
  }

  return { status: 200, body: String(id) };
};
