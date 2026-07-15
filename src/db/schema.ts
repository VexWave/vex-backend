import {
  pgTable,
  integer,
  bytea,
  timestamp,
  text,
  primaryKey,
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

export const track = pgTable("track", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  durationMs: integer("duration_ms").notNull(),
  compressed_data: bytea("data").notNull(),
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
    trackId: integer("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.trackId] })],
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
