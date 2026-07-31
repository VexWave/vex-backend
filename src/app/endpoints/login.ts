import type { AppRouteImplementation } from "@ts-rest/fastify";
import {
  generateToken,
  verifyAgainstDummyHash,
  verifyPassword,
} from "../../auth";
import { db } from "../../db";
import { session } from "../../db/schema";
import { RateLimiter } from "../../security/rateLimit";
import { ApiContract } from "../../../contract/contract";

// Per-account budget, on top of the per-address one in the rate-limit hook.
// This is what covers an attack spread across many source addresses, where no
// single address ever looks busy.
//
// Deliberately loose, and cleared on a successful login: a tight limit keyed
// on a username an attacker chooses would let them lock a known account out of
// its own password by burning the budget on purpose.
const attemptsPerAccount = new RateLimiter(30, 15 * 60_000);

export const login: AppRouteImplementation<typeof ApiContract.login> = async ({
  body,
  reply,
}) => {
  const { username, password } = body;

  // Usernames are stored case-sensitively, so fold the key: otherwise
  // alternating the capitalisation would hand the attacker a fresh budget for
  // each spelling of the same guess.
  const accountKey = username.toLowerCase();
  const retryAfter = attemptsPerAccount.hit(accountKey);
  if (retryAfter !== null) {
    reply.header("retry-after", String(retryAfter));
    return { status: 429, body: "Too many login attempts" };
  }

  const account = await db.query.user.findFirst({
    columns: { id: true, password: true },
    where: { username },
  });

  if (!account) {
    // Hash anyway. Returning here without doing the work would make an unknown
    // username answer in a fraction of the time a known one takes, which is
    // all it takes to enumerate accounts.
    await verifyAgainstDummyHash(password);
    return { status: 401, body: "Invalid username or password" };
  }

  if (!(await verifyPassword(password, account.password))) {
    return { status: 401, body: "Invalid username or password" };
  }

  attemptsPerAccount.reset(accountKey);

  const token = generateToken();
  await db.insert(session).values({ token, userId: account.id });

  return { status: 200, body: { token } };
};
