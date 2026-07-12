import type { AppRouteImplementation } from "@ts-rest/fastify";
import { generateToken, verifyPassword } from "../../auth";
import { db } from "../../db";
import { session } from "../../db/schema";
import { ApiContract } from "../../../contract/contract";

export const login: AppRouteImplementation<typeof ApiContract.login> = async ({
  body,
}) => {
  const { username, password } = body;

  const account = await db.query.user.findFirst({
    columns: { id: true, password: true },
    where: { username },
  });

  if (!account || !(await verifyPassword(password, account.password))) {
    return { status: 401, body: "Invalid username or password" };
  }

  const token = generateToken();
  await db.insert(session).values({ token, userId: account.id });

  return { status: 200, body: { token } };
};
