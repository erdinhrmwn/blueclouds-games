-- Rooms (docs/architecture/database.md): the platform generates every code and keeps one row per room.
-- The player who opens a table picks public (listed in the lobby, anyone may join) or private (only players
-- with its invite link). A tournament room has its own rule: only its assigned players.

CREATE TABLE rooms (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug             text NOT NULL REFERENCES games(slug),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,8}$'),  -- never reused
  visibility            text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  tournament_id         uuid,                                                  -- null = not a tournament room
  created_by_player_id  uuid REFERENCES players(id) ON DELETE SET NULL,        -- a player pressed "New table"
  created_by_admin_id   uuid REFERENCES admins(id),                            -- an admin made it in the backoffice
  started_at            timestamptz,                                           -- tournament rooms: when the match began
  closed_at             timestamptz,                                           -- tournament rooms: when it was done
  close_reason          text CHECK (close_reason IN ('finished', 'not_enough_players')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tournament_id, game_slug) REFERENCES tournaments(id, game_slug),
  UNIQUE (id, tournament_id),
  CONSTRAINT rooms_check CHECK (num_nonnulls(created_by_player_id, created_by_admin_id) <= 1),  -- neither = the platform
  CONSTRAINT rooms_tournament_creator_check CHECK (tournament_id IS NULL OR created_by_player_id IS NULL),
  CONSTRAINT rooms_closed_check CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  CONSTRAINT rooms_open_untracked_check CHECK (tournament_id IS NOT NULL OR (started_at IS NULL AND closed_at IS NULL))
);
CREATE INDEX rooms_game_slug_id_idx ON rooms (game_slug, id DESC);
CREATE INDEX rooms_tournament_id_idx ON rooms (tournament_id) WHERE tournament_id IS NOT NULL;
-- The SET NULL lookup when a guest is deleted.
CREATE INDEX rooms_created_by_player_id_idx ON rooms (created_by_player_id) WHERE created_by_player_id IS NOT NULL;
CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who sits where in a tournament room.
CREATE TABLE room_assignments (
  room_id               uuid NOT NULL,
  tournament_id         uuid NOT NULL,  -- copied from the room so the rules below are constraints
  player_id             uuid NOT NULL REFERENCES players(id),
  seat                  smallint CHECK (seat BETWEEN 0 AND 31),  -- null = any free seat
  assigned_by_admin_id  uuid REFERENCES admins(id),              -- null = placed by the distribute job
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id),
  FOREIGN KEY (room_id, tournament_id) REFERENCES rooms(id, tournament_id),
  FOREIGN KEY (tournament_id, player_id) REFERENCES tournament_players(tournament_id, player_id),
  UNIQUE (room_id, seat),
  UNIQUE (tournament_id, player_id)
);
CREATE INDEX room_assignments_player_id_idx ON room_assignments (player_id);
CREATE TRIGGER room_assignments_updated_at BEFORE UPDATE ON room_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A private table's invite link: 16 random bytes as 32 lowercase hex characters, valid until the opener resets it.
CREATE TABLE room_invites (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  room_id               uuid NOT NULL REFERENCES rooms(id),
  secret                text NOT NULL UNIQUE CHECK (secret ~ '^[0-9a-f]{32}$'),
  created_by_player_id  uuid REFERENCES players(id) ON DELETE SET NULL,  -- guest cleanup may delete them
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- One live link per room; making a new one revokes the old.
CREATE UNIQUE INDEX room_invites_one_link_idx ON room_invites (room_id) WHERE revoked_at IS NULL;
CREATE INDEX room_invites_created_by_player_id_idx ON room_invites (created_by_player_id) WHERE created_by_player_id IS NOT NULL;
CREATE TRIGGER room_invites_updated_at BEFORE UPDATE ON room_invites FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who may enter a private room: its opener, and everyone who redeemed its invite. Not history, so a deleted guest
-- takes its rows with it.
CREATE TABLE room_members (
  room_id     uuid NOT NULL REFERENCES rooms(id),
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id)
);
CREATE INDEX room_members_player_id_idx ON room_members (player_id);
CREATE TRIGGER room_members_updated_at BEFORE UPDATE ON room_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roll back:
--   DROP TABLE room_members, room_invites, room_assignments, rooms;
