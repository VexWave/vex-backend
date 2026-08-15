// Read-only views of what a user owns.
//
// These go through `UserManager`, unlike the queries in `cli/users.ts`:
// `listTracks`/`listArtists`/`listPlaylists` already return these rows scoped to
// one user. Nothing here writes.

import * as p from "@clack/prompts";
import { UserManager } from "../src/userManager";
import { duration, plural, table, type Column } from "./ui";
import type { UserRow } from "./users";

/** `imageUrl`/`coverUrl` are set exactly when the image exists. */
const has = (url: string | undefined): string =>
  url === undefined ? "—" : "yes";

async function view<Item>(
  row: UserRow,
  noun: string,
  load: (manager: UserManager) => Promise<Item[]>,
  columns: Column<Item>[],
): Promise<void> {
  const items = await load(UserManager.forUserId(row.id));
  if (items.length === 0) {
    p.log.info(`${row.username} has no ${noun}s.`);
    return;
  }
  p.note(
    table(columns, items),
    `${plural(items.length, noun)} — ${row.username}`,
  );
}

export function viewTracks(row: UserRow): Promise<void> {
  return view(row, "track", (manager) => manager.listTracks(), [
    { header: "title", value: (t) => t.title, max: 44 },
    {
      header: "artists",
      value: (t) => (t.artists.length === 0 ? "—" : t.artists.join(", ")),
      max: 28,
    },
    { header: "length", value: (t) => duration(t.duration), right: true },
    { header: "cover", value: (t) => has(t.coverUrl) },
  ]);
}

export function viewArtists(row: UserRow): Promise<void> {
  return view(row, "artist", (manager) => manager.listArtists(), [
    { header: "id", value: (a) => String(a.id), right: true },
    { header: "name", value: (a) => a.name, max: 48 },
    { header: "image", value: (a) => has(a.imageUrl) },
  ]);
}

export function viewPlaylists(row: UserRow): Promise<void> {
  return view(row, "playlist", (manager) => manager.listPlaylists(), [
    { header: "id", value: (l) => String(l.id), right: true },
    { header: "name", value: (l) => l.name, max: 48 },
    { header: "tracks", value: (l) => String(l.trackIds.length), right: true },
    { header: "image", value: (l) => has(l.imageUrl) },
  ]);
}
