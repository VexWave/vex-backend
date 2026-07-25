import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

// drizzle-orm v1 relations API (replaces the old `relations()` helper).
// This powers the `db.query.*` relational query builder.
//
// Every foreign-key relationship in the schema is declared here so it can be
// traversed with `db.query.<table>.findX({ with: { <relation>: true } })`.
// `optional: false` marks a required (NOT NULL) owner side so the result type
// is non-nullable.
//
// artist <-> track is many-to-many, resolved through the `artistToTrack`
// junction table via the v1 `.through()` helper.
export const relations = defineRelations(schema, (r) => ({
  user: {
    tracks: r.many.track({ from: r.user.id, to: r.track.userId }),
    artists: r.many.artist({ from: r.user.id, to: r.artist.userId }),
    playlists: r.many.playlist({ from: r.user.id, to: r.playlist.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
  },
  artist: {
    owner: r.one.user({
      from: r.artist.userId,
      to: r.user.id,
      optional: false,
    }),
    tracks: r.many.track({
      from: r.artist.id.through(r.artistToTrack.artistId),
      to: r.track.id.through(r.artistToTrack.trackId),
    }),
  },
  track: {
    owner: r.one.user({
      from: r.track.userId,
      to: r.user.id,
      optional: false,
    }),
    artists: r.many.artist({
      from: r.track.id.through(r.artistToTrack.trackId),
      to: r.artist.id.through(r.artistToTrack.artistId),
    }),
  },
  // playlist <-> track is deliberately NOT a `.through()` many-to-many: the
  // junction row's `position` carries the playback order and the same track
  // may appear twice, so queries traverse to the junction itself (`entries`,
  // ordered by `position`) instead of straight to the tracks.
  playlist: {
    owner: r.one.user({
      from: r.playlist.userId,
      to: r.user.id,
      optional: false,
    }),
    entries: r.many.playlistTrack({
      from: r.playlist.id,
      to: r.playlistTrack.playlistId,
    }),
  },
  playlistTrack: {
    playlist: r.one.playlist({
      from: r.playlistTrack.playlistId,
      to: r.playlist.id,
      optional: false,
    }),
    track: r.one.track({
      from: r.playlistTrack.trackId,
      to: r.track.id,
      optional: false,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
  },
}));
