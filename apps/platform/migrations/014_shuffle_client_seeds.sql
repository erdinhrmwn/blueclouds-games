-- Every shuffle has its own client seed now, "match_id:round:seat:nonce" (docs/architecture/fairness.md, Erdin,
-- 2026-11-13). The move log's shuffle events hold the round, seat and nonce, so the match keeps only its server
-- seed and that seed's hash. Dropping client_seed also drops matches_fairness_check, which named it.

ALTER TABLE matches
  DROP COLUMN client_seed,
  ADD CONSTRAINT matches_fairness_check CHECK (num_nulls(server_seed_hash, server_seed) IN (0, 2));

-- Roll back (the dropped client seeds are gone; earlier rows get none):
--   ALTER TABLE matches
--     DROP CONSTRAINT matches_fairness_check,
--     ADD COLUMN client_seed text CHECK (char_length(client_seed) BETWEEN 1 AND 1000);
