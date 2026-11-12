-- Tournaments (docs/architecture/database.md): an admin registers many players, the platform spreads them over
-- rooms when registration closes, and each room starts on its own at starts_at.

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
  CONSTRAINT tournaments_window_check
    CHECK (registration_opens_at < registration_closes_at AND registration_closes_at <= starts_at),
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

-- Roll back:
--   DROP TABLE tournament_players, tournaments;
