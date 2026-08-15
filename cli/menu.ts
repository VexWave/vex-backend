// The menus. Main menu → user picker → per-user menu; each level loops until
// "Back" rather than falling out after one action.

import * as p from "@clack/prompts";
import { env } from "../src/env";
import { viewArtists, viewPlaylists, viewTracks } from "./library";
import { ask, bytes, date, plural, table } from "./ui";
import {
  createUser,
  deleteUser,
  findUser,
  listUsers,
  manageSessions,
  renameUser,
  setPassword,
  type UserRow,
} from "./users";

/** Database and host, credentials dropped — shown before anything is touched. */
function target(): string {
  const url = new URL(env.DATABASE_URL);
  return `${url.pathname.replace(/^\//, "")} on ${url.host}`;
}

export async function run(): Promise<void> {
  p.intro(`vex admin  ·  ${target()}`);

  for (;;) {
    const action = await ask(
      p.select({
        message: "What do you want to do?",
        options: [
          { value: "browse" as const, label: "Browse users" },
          { value: "create" as const, label: "Create user" },
          { value: "quit" as const, label: "Exit" },
        ],
      }),
    );

    if (action === "quit") {
      break;
    }
    if (action === "create") {
      await createUser();
    } else {
      await browse();
    }
  }

  p.outro("Done.");
}

async function browse(): Promise<void> {
  for (;;) {
    const users = await listUsers();
    if (users.length === 0) {
      p.log.info("There are no users yet — create one.");
      return;
    }

    p.note(
      table(
        [
          { header: "id", value: (u) => `#${u.id}`, right: true },
          { header: "username", value: (u) => u.username, max: 32 },
          { header: "tracks", value: (u) => String(u.tracks), right: true },
          { header: "audio", value: (u) => bytes(u.audioBytes), right: true },
          { header: "created", value: (u) => date(u.createdAt) },
        ],
        users,
      ),
      plural(users.length, "user"),
    );

    const chosen = await ask(
      p.select<number | "back">({
        message: "Which user?",
        options: [
          ...users.map((each) => ({
            value: each.id,
            label: each.username,
            hint: `#${each.id} · ${plural(each.tracks, "track")}`,
          })),
          { value: "back" as const, label: "Back" },
        ],
      }),
    );

    if (chosen === "back") {
      return;
    }
    await userMenu(chosen);
  }
}

function summary(row: UserRow): string {
  return [
    `created   ${date(row.createdAt)}`,
    `tracks    ${row.tracks}  (${bytes(row.audioBytes)})`,
    `artists   ${row.artists}`,
    `playlists ${row.playlists}`,
    `sessions  ${row.sessions}`,
  ].join("\n");
}

async function userMenu(id: number): Promise<void> {
  // Re-read only after something changed the counts. The listing aggregates
  // every track's `octet_length`, so refreshing it on plain navigation would
  // re-run that sum each time the operator backs out of a view.
  let row = await findUser(id);

  for (;;) {
    if (row === undefined) {
      p.log.warn(`User #${id} no longer exists.`);
      return;
    }

    p.note(summary(row), `${row.username}  ·  #${row.id}`);

    const action = await ask(
      p.select({
        message: `Manage ${row.username}`,
        options: [
          { value: "tracks" as const, label: "View tracks" },
          { value: "artists" as const, label: "View artists" },
          { value: "playlists" as const, label: "View playlists" },
          {
            value: "sessions" as const,
            label: "Sessions",
            hint: plural(row.sessions, "active session"),
          },
          { value: "rename" as const, label: "Rename" },
          { value: "password" as const, label: "Set password" },
          {
            value: "delete" as const,
            label: "Delete user",
            hint: "removes their whole library",
          },
          { value: "back" as const, label: "Back" },
        ],
      }),
    );

    switch (action) {
      case "tracks":
        await viewTracks(row);
        break;
      case "artists":
        await viewArtists(row);
        break;
      case "playlists":
        await viewPlaylists(row);
        break;
      case "sessions":
        await manageSessions(row);
        row = await findUser(id);
        break;
      case "rename":
        await renameUser(row);
        row = await findUser(id);
        break;
      case "password":
        await setPassword(row);
        row = await findUser(id);
        break;
      case "delete":
        if (await deleteUser(row)) {
          return;
        }
        break;
      case "back":
        return;
    }
  }
}
