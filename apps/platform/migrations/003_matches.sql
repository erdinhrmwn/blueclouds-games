-- id is chosen by the room (UUIDv7) and doubles as the idempotency key for reports.
CREATE TABLE matches (
  id             uuid PRIMARY KEY,
  game_slug      text NOT NULL,
  room_code      text NOT NULL,
  rules_version  int NOT NULL,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL,
  body_hash      bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_game_ended ON matches (game_slug, ended_at DESC);

CREATE TABLE match_players (
  match_id    uuid NOT NULL REFERENCES matches(id),
  seat        smallint NOT NULL,
  player_id   uuid REFERENCES players(id),  -- null for bots
  bot_name    text,
  placement   smallint NOT NULL,
  lives_left  smallint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_players_player ON match_players (player_id, match_id DESC) WHERE player_id IS NOT NULL;

CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER match_players_updated_at BEFORE UPDATE ON match_players FOR EACH ROW EXECUTE FUNCTION set_updated_at();
