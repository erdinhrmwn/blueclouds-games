-- Provably fair shuffles (docs/architecture/fairness.md): a match's seeds, revealed when it ended. The room
-- committed to sha256(server_seed) before the match; client_seed is the match id plus the seating. The move log
-- holds every shuffle, so anyone with these can check them. Matches from before have none.

ALTER TABLE matches
  ADD COLUMN server_seed_hash text CHECK (server_seed_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN server_seed text CHECK (server_seed ~ '^[0-9a-f]{64}$'),
  ADD COLUMN client_seed text CHECK (char_length(client_seed) BETWEEN 1 AND 1000),
  ADD CONSTRAINT matches_fairness_check CHECK (num_nulls(server_seed_hash, server_seed, client_seed) IN (0, 3));

-- Roll back:
--   ALTER TABLE matches DROP COLUMN client_seed, DROP COLUMN server_seed, DROP COLUMN server_seed_hash;
