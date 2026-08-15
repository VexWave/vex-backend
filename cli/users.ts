// User lifecycle for the admin CLI: create, rename, set password, delete,
// revoke sessions, and the cross-user listing the menus browse.
//
// These queries stay here rather than in `UserManager`: that class scopes every
// query to a single `userId`, which is exactly what "list every user" cannot do.
// The read-only views in `cli/library.ts` do go through it.

import * as p from "@clack/prompts";
import { eq } from "drizzle-orm";
import { LoginRequest } from "../contract/contract";
import { hashPassword } from "../src/auth";
import { db } from "../src/db";
import { session, user } from "../src/db/schema";
import { clean } from "../src/logger";
import { ask, bytes, dateTime, plural, table } from "./ui";

export type UserRow = {
  id: number;
  username: string;
  createdAt: Date;
  tracks: number;
  audioBytes: number;
  artists: number;
  playlists: number;
  sessions: number;
};

export async function listUsers(): Promise<UserRow[]> {
  return await queryUsers();
}

export async function findUser(id: number): Promise<UserRow | undefined> {
  return (await queryUsers({ id }))[0];
}

async function queryUsers(where?: { id: number }): Promise<UserRow[]> {
  const rows = await db.query.user.findMany({
    columns: { id: true, username: true, createdAt: true },
    where,
    // The casts are load-bearing: postgres.js returns int8 (`count`) and numeric
    // (`sum`) as strings, and float8 as a number. `octet_length` gets a track's
    // size without reading the track.
    extras: {
      tracks: (t, { sql }) =>
        sql<number>`(select count(*) from "track" where "track"."user_id" = ${t.id})::int`,
      audioBytes: (t, { sql }) =>
        sql<number>`(select coalesce(sum(octet_length("data")), 0) from "track" where "track"."user_id" = ${t.id})::float8`,
      artists: (t, { sql }) =>
        sql<number>`(select count(*) from "artist" where "artist"."user_id" = ${t.id})::int`,
      playlists: (t, { sql }) =>
        sql<number>`(select count(*) from "playlist" where "playlist"."user_id" = ${t.id})::int`,
      sessions: (t, { sql }) =>
        sql<number>`(select count(*) from "session" where "session"."user_id" = ${t.id})::int`,
    },
    orderBy: { id: "asc" },
  });

  // Cleaned once here rather than at each render: a username reaches the
  // terminal through menu labels, prompts and `p.note` titles, and only the
  // cells inside `table()` are cleaned on the way out.
  return rows.map((row) => ({ ...row, username: clean(row.username, 64) }));
}

// The contract's own bounds, so an account created here is one `POST /login`
// accepts. Zod schemas are Standard Schemas, which is the other form clack's
// `validate` takes besides a function.
const usernameRule = LoginRequest.shape.username;
const passwordRule = LoginRequest.shape.password;

/** Postgres unique_violation — here, always a username collision. */
function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function newPassword(message: string): Promise<string | null> {
  const chosen = await ask(p.password({ message, validate: passwordRule }));
  const again = await ask(p.password({ message: "Confirm password" }));
  if (chosen !== again) {
    p.log.error("Passwords did not match — nothing was changed.");
    return null;
  }
  return chosen;
}

export async function createUser(): Promise<void> {
  const username = await ask(
    p.text({ message: "Username", validate: usernameRule }),
  );

  // Checked before asking for a password, so a collision doesn't waste the
  // typing. The insert still handles it: this read and that write can race.
  const taken = await db.query.user.findFirst({
    columns: { id: true },
    where: { username },
  });
  if (taken !== undefined) {
    p.log.error(`"${username}" is already taken.`);
    return;
  }

  const chosen = await newPassword("Password");
  if (chosen === null) {
    return;
  }

  // The hash goes inside the `try`: it is the slow step, and a spinner left
  // running holds an interval and raw-mode stdin open, which would keep the
  // process alive after the error had already been reported.
  const spinner = p.spinner();
  spinner.start("Hashing password");
  try {
    const hashed = await hashPassword(chosen);
    const [created] = await db
      .insert(user)
      .values({ username, password: hashed })
      .returning({ id: user.id });
    spinner.stop(`Created ${username} (#${created?.id ?? "?"})`);
  } catch (error) {
    spinner.error("Could not create the user");
    if (!isDuplicate(error)) {
      throw error;
    }
    p.log.error(`"${username}" was taken a moment ago.`);
  }
}

export async function renameUser(row: UserRow): Promise<void> {
  const username = await ask(
    p.text({
      message: `New username for ${row.username}`,
      initialValue: row.username,
      validate: usernameRule,
    }),
  );
  if (username === row.username) {
    p.log.info("Unchanged.");
    return;
  }

  try {
    await db.update(user).set({ username }).where(eq(user.id, row.id));
  } catch (error) {
    if (!isDuplicate(error)) {
      throw error;
    }
    p.log.error(`"${username}" is already taken.`);
    return;
  }
  p.log.success(`#${row.id} is now "${username}".`);
}

export async function setPassword(row: UserRow): Promise<void> {
  const chosen = await newPassword(`New password for ${row.username}`);
  if (chosen === null) {
    return;
  }

  // Sessions never expire, so without this the tokens the old password minted
  // keep working.
  const revoke =
    row.sessions > 0 &&
    (await ask(
      p.confirm({
        message: `Also revoke ${plural(row.sessions, "session")}? They stay valid otherwise.`,
        initialValue: true,
      }),
    ));

  // Hashed outside the transaction: argon2 is slow enough to hold the row lock
  // for no reason.
  const hashed = await hashPassword(chosen);

  await db.transaction(async (tx) => {
    await tx.update(user).set({ password: hashed }).where(eq(user.id, row.id));
    if (revoke) {
      await tx.delete(session).where(eq(session.userId, row.id));
    }
  });

  p.log.success(
    revoke
      ? `Password changed and ${plural(row.sessions, "session")} revoked.`
      : "Password changed.",
  );
}

/** True when the user was deleted, so the caller can leave their menu. */
export async function deleteUser(row: UserRow): Promise<boolean> {
  p.note(
    [
      `${plural(row.tracks, "track").padEnd(16)}${bytes(row.audioBytes)}`,
      plural(row.artists, "artist"),
      plural(row.playlists, "playlist"),
      plural(row.sessions, "session"),
    ].join("\n"),
    `Deleting "${row.username}" also removes`,
  );

  const typed = await ask(
    p.text({
      message: `Type "${row.username}" to confirm. This cannot be undone.`,
      placeholder: row.username,
    }),
  );
  if (typed !== row.username) {
    p.log.warn("That did not match — nothing was deleted.");
    return false;
  }

  // Their tracks, artists, playlists and sessions go with them: see the
  // ON DELETE CASCADE on `user` in `src/db/schema.ts`.
  await db.delete(user).where(eq(user.id, row.id));
  p.log.success(
    `Deleted "${row.username}" (#${row.id}) and everything they owned.`,
  );
  return true;
}

export async function manageSessions(row: UserRow): Promise<void> {
  const sessions = await db.query.session.findMany({
    columns: { id: true, createdAt: true },
    where: { userId: row.id },
    orderBy: { createdAt: "desc" },
  });

  if (sessions.length === 0) {
    p.log.info(`${row.username} has no active sessions.`);
    return;
  }

  // Never render the token, not even truncated — it is a live credential.
  p.note(
    table(
      [
        { header: "id", value: (s) => String(s.id), right: true },
        { header: "opened", value: (s) => dateTime(s.createdAt) },
      ],
      sessions,
    ),
    `${plural(sessions.length, "session")} — ${row.username}`,
  );

  const choice = await ask(
    p.select({
      message: "Sessions",
      options: [
        { value: "one" as const, label: "Revoke one" },
        { value: "all" as const, label: `Revoke all ${sessions.length}` },
        { value: "back" as const, label: "Back" },
      ],
    }),
  );

  if (choice === "back") {
    return;
  }

  if (choice === "all") {
    await db.delete(session).where(eq(session.userId, row.id));
    p.log.success(`Revoked ${plural(sessions.length, "session")}.`);
    return;
  }

  const id = await ask(
    p.select<number | "back">({
      message: "Which session?",
      options: [
        ...sessions.map((each) => ({
          value: each.id,
          label: `#${each.id}`,
          hint: `opened ${dateTime(each.createdAt)}`,
        })),
        { value: "back" as const, label: "Back" },
      ],
    }),
  );
  if (id === "back") {
    return;
  }

  await db.delete(session).where(eq(session.id, id));
  p.log.success(`Revoked session #${id}.`);
}
