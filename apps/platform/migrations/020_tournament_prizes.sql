-- Prizes by finishing place (Erdin 2026-11-13): coins for each place, and an optional extra such as a badge. The
-- lobby's Detail shows them as a podium and their sum as the prize pool. There is no wallet, so nothing is paid out.
-- This replaces the one free-text prize from migration 019; it was only ever display text, so it is dropped.
-- Rollback:
--   DROP TABLE tournament_prizes;
--   ALTER TABLE tournaments ADD COLUMN prize text
--     CONSTRAINT tournaments_prize_check CHECK (prize IS NULL OR (char_length(prize) BETWEEN 1 AND 60 AND prize = btrim(prize)));
CREATE TABLE tournament_prizes (
  tournament_id  uuid NOT NULL REFERENCES tournaments(id),
  place          smallint NOT NULL CHECK (place BETWEEN 1 AND 10),
  coins          integer NOT NULL CHECK (coins BETWEEN 0 AND 1000000000),
  extra          text CHECK (extra IS NULL OR (char_length(extra) BETWEEN 1 AND 40 AND extra = btrim(extra))),
  PRIMARY KEY (tournament_id, place)
);

ALTER TABLE tournaments DROP COLUMN prize;
