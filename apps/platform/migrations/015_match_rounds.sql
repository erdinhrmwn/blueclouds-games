-- Round history and per-round seeds (docs/architecture/fairness.md, Erdin 2026-11-13). Every round has its own
-- server seed, revealed when the round closes, so a room sends each round as it closes and a running match
-- shows its rounds too. A round's data and its fairness live in two tables; matches keeps no seed. Rounds, like
-- matches, are public and append-only.

-- One row per closed round. No foreign key to matches: that row only arrives when the match ends.
CREATE TABLE match_rounds (
  id          uuid PRIMARY KEY CHECK (substr(id::text, 15, 1) = '7'),  -- made by the room with the round's seed
  match_id    uuid NOT NULL CHECK (substr(match_id::text, 15, 1) = '7'),
  round       int NOT NULL CHECK (round BETWEEN 1 AND 1000),
  game_slug   text NOT NULL REFERENCES games(slug),
  room_id     uuid NOT NULL REFERENCES rooms(id),
  -- What happened in the round, in the game's own shape (Bust 31: who busted; Cloudburst: who went out).
  result      jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  -- Every move of the round from its deal on, as the match's move log has them (docs/architecture/match-log.md).
  events      jsonb NOT NULL CHECK (jsonb_typeof(events) = 'array' AND jsonb_array_length(events) >= 1),
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  body_hash   bytea NOT NULL CHECK (octet_length(body_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_rounds_ended_check CHECK (ended_at >= started_at)
);
CREATE UNIQUE INDEX match_rounds_match_id_round_key ON match_rounds (match_id, round);
CREATE INDEX match_rounds_room_id_idx ON match_rounds (room_id);
CREATE TRIGGER match_rounds_updated_at BEFORE UPDATE ON match_rounds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER match_rounds_append_only BEFORE UPDATE OR DELETE ON match_rounds FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- One row per shuffle of a closed round: the deal is nonce 0, each reshuffle counts up. The round's server seed
-- was committed (its hash shown) before the round and revealed when it closed; the client seed is
-- match_id:round:nonce.
CREATE TABLE round_fairness (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  round_id          uuid NOT NULL REFERENCES match_rounds(id),
  match_id          uuid NOT NULL,
  nonce             int NOT NULL CHECK (nonce BETWEEN 0 AND 100),
  server_seed_hash  text NOT NULL CHECK (server_seed_hash ~ '^[0-9a-f]{64}$'),
  server_seed       text NOT NULL CHECK (server_seed ~ '^[0-9a-f]{64}$'),
  client_seed       text NOT NULL CHECK (char_length(client_seed) BETWEEN 1 AND 100),
  deck              jsonb NOT NULL CHECK (jsonb_typeof(deck) = 'array' AND jsonb_array_length(deck) >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX round_fairness_round_id_nonce_key ON round_fairness (round_id, nonce);
CREATE INDEX round_fairness_match_id_idx ON round_fairness (match_id);
CREATE TRIGGER round_fairness_updated_at BEFORE UPDATE ON round_fairness FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER round_fairness_append_only BEFORE UPDATE OR DELETE ON round_fairness FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Seeds now live per round: a match keeps none.
ALTER TABLE matches
  DROP CONSTRAINT matches_fairness_check,
  DROP COLUMN server_seed_hash,
  DROP COLUMN server_seed;

-- Roll back (the dropped match seeds are gone; earlier rows get none):
--   ALTER TABLE matches
--     ADD COLUMN server_seed_hash text CHECK (server_seed_hash ~ '^[0-9a-f]{64}$'),
--     ADD COLUMN server_seed text CHECK (server_seed ~ '^[0-9a-f]{64}$'),
--     ADD CONSTRAINT matches_fairness_check CHECK (num_nulls(server_seed_hash, server_seed) IN (0, 2));
--   DROP TABLE round_fairness, match_rounds;
