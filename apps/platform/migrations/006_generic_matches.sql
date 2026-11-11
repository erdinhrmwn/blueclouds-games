-- Generic match data (docs/architecture/match-schema.md): every game reports into the same tables.
-- A new game only inserts its row into `games`; what `score` means is up to the game.

CREATE TABLE games (
  slug         text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  min_players  smallint NOT NULL CHECK (min_players >= 1),
  max_players  smallint NOT NULL CHECK (max_players BETWEEN min_players AND 32),
  score_label  text NOT NULL CHECK (char_length(score_label) BETWEEN 1 AND 24),  -- what match_players.score means
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO games (slug, name, min_players, max_players, score_label) VALUES ('bust-31', 'Bust 31', 2, 6, 'Lives left');

ALTER TABLE matches ADD CONSTRAINT matches_game_fk FOREIGN KEY (game_slug) REFERENCES games(slug);

-- One game-defined number per seat (Bust 31: lives left, Cloudburst: points). Ranking always uses placement.
ALTER TABLE match_players RENAME COLUMN lives_left TO score;
ALTER TABLE match_players ALTER COLUMN score TYPE int;

-- A seat is either a player or a named bot.
UPDATE match_players SET bot_name = 'Bot' WHERE player_id IS NULL AND bot_name IS NULL;
ALTER TABLE match_players ADD CONSTRAINT match_players_player_or_bot CHECK ((player_id IS NULL) = (bot_name IS NOT NULL));

-- Roll back:
--   ALTER TABLE match_players DROP CONSTRAINT match_players_player_or_bot;
--   ALTER TABLE match_players ALTER COLUMN score TYPE smallint;
--   ALTER TABLE match_players RENAME COLUMN score TO lives_left;
--   ALTER TABLE matches DROP CONSTRAINT matches_game_fk;
--   DROP TABLE games;
