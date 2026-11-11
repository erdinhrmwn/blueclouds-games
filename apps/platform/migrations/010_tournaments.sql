-- Tournaments (docs/architecture/database.md): an admin registers many players, the platform spreads them
-- over rooms when registration closes, and each room starts on its own at starts_at.

CREATE TABLE tournaments (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug               text NOT NULL REFERENCES games(slug),
  name                    text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  players_per_room        smallint NOT NULL CHECK (players_per_room BETWEEN 1 AND 32),  -- within the game's min/max, checked on save
  starts_at               timestamptz NOT NULL,
  registration_opens_at   timestamptz NOT NULL DEFAULT now(),
  registration_closes_at  timestamptz NOT NULL,  -- also when the job hands out rooms
  distributed_at          timestamptz,
  distribute_error        text,                  -- why the last automatic run couldn't
  cancelled_at            timestamptz,
  ended_at                timestamptz,           -- when its last room closed
  created_by_admin_id     uuid NOT NULL REFERENCES admins(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, game_slug),  -- lets rooms check they play the tournament's game
  CONSTRAINT tournaments_window_check CHECK (registration_opens_at < registration_closes_at AND registration_closes_at <= starts_at),
  CONSTRAINT tournaments_ended_check CHECK (ended_at IS NULL OR ended_at >= starts_at)
);
CREATE INDEX tournaments_starts_at_idx ON tournaments (starts_at DESC);
CREATE INDEX tournaments_due_idx ON tournaments (registration_closes_at) WHERE distributed_at IS NULL AND cancelled_at IS NULL;
CREATE TRIGGER tournaments_updated_at BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tournament_players (
  tournament_id           uuid NOT NULL REFERENCES tournaments(id),
  player_id               uuid NOT NULL REFERENCES players(id),
  registered_by_admin_id  uuid REFERENCES admins(id),  -- null = the player signed up themselves
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX tournament_players_player_id_idx ON tournament_players (player_id);
CREATE TRIGGER tournament_players_updated_at BEFORE UPDATE ON tournament_players FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE rooms
  ADD COLUMN tournament_id uuid,              -- null = an open room anyone with the code can join
  ADD COLUMN started_at    timestamptz,       -- tournament rooms: when the match began
  ADD COLUMN closed_at     timestamptz,       -- tournament rooms: when it was done
  ADD COLUMN close_reason  text CHECK (close_reason IN ('finished', 'not_enough_players')),
  ADD FOREIGN KEY (tournament_id, game_slug) REFERENCES tournaments(id, game_slug),
  ADD UNIQUE (id, tournament_id),
  ADD CONSTRAINT rooms_tournament_creator_check CHECK (tournament_id IS NULL OR created_by_player_id IS NULL),
  ADD CONSTRAINT rooms_closed_check CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  ADD CONSTRAINT rooms_open_untracked_check CHECK (tournament_id IS NOT NULL OR (started_at IS NULL AND closed_at IS NULL));
CREATE INDEX rooms_tournament_id_idx ON rooms (tournament_id) WHERE tournament_id IS NOT NULL;

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

ALTER TABLE admin_audit_events
  ADD COLUMN tournament_id uuid REFERENCES tournaments(id),
  ADD COLUMN room_id uuid REFERENCES rooms(id),
  DROP CONSTRAINT admin_audit_events_action_check,
  ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'login', 'login_failed', 'logout', 'player.disable', 'player.enable',
    'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
    'room.assign', 'room.unassign'));

-- Roll back (tournament audit rows stay as history, so the old action list comes back NOT VALID):
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check,
--     ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN ('login', 'login_failed', 'logout', 'player.disable', 'player.enable')) NOT VALID,
--     DROP COLUMN room_id, DROP COLUMN tournament_id;
--   DROP TABLE room_assignments;
--   ALTER TABLE rooms DROP COLUMN close_reason, DROP COLUMN closed_at, DROP COLUMN started_at, DROP COLUMN tournament_id;
--   DROP TABLE tournament_players, tournaments;
