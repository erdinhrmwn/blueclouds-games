-- Rooms are made by the platform (docs/architecture/database.md): it generates every code and keeps one row
-- per room. A match links to its room instead of repeating the code.

CREATE TABLE rooms (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug             text NOT NULL REFERENCES games(slug),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,8}$'),  -- never reused
  created_by_player_id  uuid REFERENCES players(id),  -- a player pressed "New table"
  created_by_admin_id   uuid REFERENCES admins(id),   -- an admin made it in the backoffice
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(created_by_player_id, created_by_admin_id) <= 1)  -- neither = made before this migration
);
CREATE INDEX rooms_game_slug_id_idx ON rooms (game_slug, id DESC);
CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every room an existing match was played in becomes a room with no known creator.
-- Codes are unique across games now; this fails (and rolls back) if two games ever shared one.
INSERT INTO rooms (game_slug, code, created_at)
SELECT game_slug, room_code, min(started_at) FROM matches GROUP BY game_slug, room_code;

-- matches is append-only (008); this one backfill says so openly.
ALTER TABLE matches DISABLE TRIGGER matches_append_only;
ALTER TABLE matches ADD COLUMN room_id uuid REFERENCES rooms(id);
UPDATE matches m SET room_id = r.id FROM rooms r WHERE r.code = m.room_code;
ALTER TABLE matches ALTER COLUMN room_id SET NOT NULL, DROP COLUMN room_code;
ALTER TABLE matches ENABLE TRIGGER matches_append_only;
CREATE INDEX matches_room_id_idx ON matches (room_id);

-- Roll back:
--   ALTER TABLE matches DISABLE TRIGGER matches_append_only;
--   ALTER TABLE matches ADD COLUMN room_code text;
--   UPDATE matches m SET room_code = r.code FROM rooms r WHERE r.id = m.room_id;
--   ALTER TABLE matches ALTER COLUMN room_code SET NOT NULL, ADD CONSTRAINT matches_room_code_check CHECK (room_code ~ '^[A-Z0-9]{4,8}$'),
--     DROP COLUMN room_id;
--   ALTER TABLE matches ENABLE TRIGGER matches_append_only;
--   DROP TABLE rooms;
