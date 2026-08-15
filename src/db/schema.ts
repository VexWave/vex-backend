import { sql } from "drizzle-orm";
import {
  pgTable,
  integer,
  bytea,
  timestamp,
  text,
  uuid,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";

// Content hash of an image column, maintained by Postgres itself so no write
// path can forget to bump it. It does two jobs at once:
//
//   - It versions the image's URL (`?v=<hash>`), which is what lets the bytes
//     be cached forever: editing an image changes the hash, so the new bytes
//     arrive under a new URL instead of hiding behind a cached old one.
//   - `md5(NULL)` is NULL, so it doubles as the "has an image" probe the
//     listings need — reading it never loads the bytes themselves.
//
// Stored (not virtual), so it costs nothing per read. Postgres recomputes a
// stored generated column on every UPDATE of the row, not only when the image
// itself is in the SET list — so renaming a track detoasts and re-hashes a
// cover nobody touched. That is the price of the guarantee above, and it is
// worth it: the alternative is every write path remembering to hash, and the
// edit routes are rare next to the reads this makes cacheable.
const imageHashOf = (column: string) =>
  text(`${column}_hash`).generatedAlwaysAs(sql.raw(`md5(${column})`));

export const artist = pgTable("artist", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  image: bytea("image"),
  imageHash: imageHashOf("image"),
  userId: integer("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// A track's id is a uuid, so it says nothing about when the track was added —
// `createdAt` is what orders the listing (see `listTracks`).
export const track = pgTable("track", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  durationMs: integer("duration_ms").notNull(),
  data: bytea("data").notNull(),
  cover: bytea("cover"),
  coverHash: imageHashOf("cover"),
  userId: integer("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Junction table for the many-to-many relationship between artists and tracks.
export const artistToTrack = pgTable(
  "artist_to_track",
  {
    artistId: integer("artist_id")
      .notNull()
      .references(() => artist.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.trackId] })],
);

export const playlist = pgTable("playlist", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  image: bytea("image"),
  imageHash: imageHashOf("image"),
  userId: integer("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Ordered playlist entries. A track may appear in a playlist at most once
// (the contract rejects duplicates), enforced by the unique constraint on
// (playlistId, trackId); the PK on (playlistId, position) keeps the playback
// order unambiguous. Deleting a track cascades here, which is what keeps
// playlists free of dangling ids (the contract requires deleted tracks to
// vanish from every playlist); gaps left in `position` are fine since only
// relative order matters.
export const playlistTrack = pgTable(
  "playlist_track",
  {
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlist.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playlistId, t.position] }),
    unique().on(t.playlistId, t.trackId),
  ],
);

// Every `user_id` cascades from here, and the junction tables cascade in turn,
// so deleting a user takes their whole library with it — audio included, with
// no undo. Only `bun run cli` deletes users; no API route does.
export const user = pgTable("user", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Logged-in user sessions. `token` is an opaque random string; sessions never
// expire and are valid until deleted.
export const session = pgTable("session", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  token: text("token").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
