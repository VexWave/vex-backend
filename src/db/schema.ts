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

export const artist = pgTable("artist", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  image: bytea("image"),
  userId: integer("user_id")
    .notNull()
    .references(() => user.id),
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
  userId: integer("user_id")
    .notNull()
    .references(() => user.id),
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
  userId: integer("user_id")
    .notNull()
    .references(() => user.id),
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
    .references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
