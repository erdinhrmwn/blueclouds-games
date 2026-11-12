-- Invites (Erdin, 2026-11-12): typing a room code no longer gets you in. The player who opens a table picks
-- public (listed in the lobby, anyone may join) or private (only players with an invite link or code).
-- A tournament room keeps its own rule: only its assigned players.

-- Rooms made before this were all listed, so they stay public. New rooms are private unless asked otherwise.
ALTER TABLE rooms ADD COLUMN visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));
ALTER TABLE rooms ALTER COLUMN visibility SET DEFAULT 'private';

-- A link (long random token, until revoked) or a code (6 characters, a few minutes). Both are redeemed the same
-- way, so they share one unique column; a link token and a code never have the same length.
CREATE TABLE room_invites (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  room_id               uuid NOT NULL REFERENCES rooms(id),
  kind                  text NOT NULL CHECK (kind IN ('link', 'code')),
  secret                text NOT NULL UNIQUE CHECK (secret ~ '^[A-Za-z0-9]{6,64}$'),
  created_by_player_id  uuid REFERENCES players(id) ON DELETE SET NULL,  -- guest cleanup may delete them
  expires_at            timestamptz,  -- null = until revoked (links)
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'code') = (expires_at IS NOT NULL))
);
-- One live link per room; making a new one revokes the old.
CREATE UNIQUE INDEX room_invites_one_link_idx ON room_invites (room_id) WHERE kind = 'link' AND revoked_at IS NULL;
CREATE INDEX room_invites_created_by_player_id_idx ON room_invites (created_by_player_id) WHERE created_by_player_id IS NOT NULL;
CREATE TRIGGER room_invites_updated_at BEFORE UPDATE ON room_invites FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who may enter a private room: its opener, and everyone who redeemed an invite. Not history, so a deleted
-- guest takes its rows with it.
CREATE TABLE room_members (
  room_id     uuid NOT NULL REFERENCES rooms(id),
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id)
);
CREATE INDEX room_members_player_id_idx ON room_members (player_id);
CREATE TRIGGER room_members_updated_at BEFORE UPDATE ON room_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Players who opened a room are its first members.
INSERT INTO room_members (room_id, player_id, created_at)
SELECT id, created_by_player_id, created_at FROM rooms WHERE created_by_player_id IS NOT NULL;

-- Roll back:
--   DROP TABLE room_members, room_invites;
--   ALTER TABLE rooms DROP COLUMN visibility;
