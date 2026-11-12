-- Finished matches (docs/architecture/match-schema.md), one row per seat, and every move for replay and audit
-- (docs/architecture/match-log.md). History: append-only.

-- id is chosen by the room (UUIDv7) and doubles as the idempotency key for reports.
CREATE TABLE matches (
  id             uuid PRIMARY KEY CHECK (substr(id::text, 15, 1) = '7'),  -- substr, not uuid_extract_version(): Postgres 16 has none
  game_slug      text NOT NULL REFERENCES games(slug),
  room_id        uuid NOT NULL REFERENCES rooms(id),
  rules_version  int NOT NULL CHECK (rules_version >= 1),
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL,
  body_hash      bytea NOT NULL CHECK (octet_length(body_hash) = 32),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_ended_check CHECK (ended_at >= started_at)
);
CREATE INDEX matches_game_slug_id_idx ON matches (game_slug, id DESC);
CREATE INDEX matches_room_id_idx ON matches (room_id);
CREATE INDEX matches_ended_at_idx ON matches (ended_at);
CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER matches_append_only BEFORE UPDATE OR DELETE ON matches FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- One game-defined number per seat (Bust 31: lives left, Cloudburst: points). Ranking always uses placement.
CREATE TABLE match_players (
  match_id    uuid NOT NULL REFERENCES matches(id),
  seat        smallint NOT NULL CHECK (seat BETWEEN 0 AND 31),
  player_id   uuid REFERENCES players(id),                           -- null for bots
  bot_name    text CHECK (char_length(bot_name) BETWEEN 1 AND 20),
  placement   smallint NOT NULL CHECK (placement BETWEEN 1 AND 32),
  score       int NOT NULL CHECK (score BETWEEN -1000000 AND 1000000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seat),
  -- A seat is either a player or a named bot.
  CONSTRAINT match_players_player_or_bot CHECK ((player_id IS NULL) = (bot_name IS NOT NULL))
);
-- One seat per player per match, and a player's history newest first.
CREATE UNIQUE INDEX match_players_player_id_match_id_key ON match_players (player_id, match_id DESC) WHERE player_id IS NOT NULL;
-- At most one winner. "At least one" stays in the API.
CREATE UNIQUE INDEX match_players_winner_key ON match_players (match_id) WHERE placement = 1;
CREATE TRIGGER match_players_updated_at BEFORE UPDATE ON match_players FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER match_players_append_only BEFORE UPDATE OR DELETE ON match_players FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- One row per match; `events` is the array the room sent, holding every hand and the deck order.
CREATE TABLE match_logs (
  match_id     uuid PRIMARY KEY REFERENCES matches(id),
  log_version  int NOT NULL CHECK (log_version >= 1),
  event_count  int NOT NULL CHECK (event_count BETWEEN 1 AND 5000),
  events       jsonb NOT NULL CHECK (jsonb_typeof(events) = 'array'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_logs_events_length_check CHECK (event_count = jsonb_array_length(events))
);
CREATE TRIGGER match_logs_updated_at BEFORE UPDATE ON match_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER match_logs_append_only BEFORE UPDATE OR DELETE ON match_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Roll back:
--   DROP TABLE match_logs, match_players, matches;
