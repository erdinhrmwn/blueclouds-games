-- A per-seat number each game defines itself (Bust 31: lives left, Cloudburst: points),
-- so every game can use the same column. Ranking always uses placement.
-- Roll back: ALTER TABLE match_players RENAME COLUMN score TO lives_left;
ALTER TABLE match_players RENAME COLUMN lives_left TO score;
