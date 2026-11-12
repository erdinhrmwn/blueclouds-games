-- The game catalog (docs/architecture/match-schema.md): every game reports into the same match tables.
-- A new game only inserts its row here; what `score` means is up to the game.

CREATE TABLE games (
  slug         text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  min_players  smallint NOT NULL CHECK (min_players >= 1),
  max_players  smallint NOT NULL,
  score_label  text NOT NULL CHECK (char_length(score_label) BETWEEN 1 AND 24),  -- what match_players.score means
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT games_check CHECK (max_players >= min_players AND max_players <= 32)
);
CREATE TRIGGER games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Bust 31 scores lives left; Cloudburst scores the points a player ended on (fewest wins).
INSERT INTO games (slug, name, min_players, max_players, score_label)
VALUES
  ('bust-31', 'Bust 31', 2, 6, 'Lives left'),
  ('cloudburst', 'Cloudburst', 2, 6, 'Points');

-- Roll back:
--   DROP TABLE games;
