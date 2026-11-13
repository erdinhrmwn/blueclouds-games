-- Final places (docs/plans/tournament-rounds.md, phase 2). Written once, by the job, when a tournament's last round
-- is done; what winners, prizes by place and a later payout read. Until phase 3 every format plays as a knockout:
-- each table's winner goes on until one player is left (Erdin 2026-11-13: several tables → a final round).
-- Rollback: DROP TABLE tournament_results;
CREATE TABLE tournament_results (
  tournament_id  uuid NOT NULL REFERENCES tournaments(id),
  player_id      uuid NOT NULL REFERENCES players(id),
  place          smallint NOT NULL CHECK (place BETWEEN 1 AND 10000),
  wins           smallint NOT NULL DEFAULT 0 CHECK (wins >= 0),       -- tables won across all rounds
  points         int NOT NULL DEFAULT 0 CHECK (points >= 0),          -- Arena and Swiss (phase 3)
  last_round     smallint NOT NULL CHECK (last_round BETWEEN 1 AND 20),  -- the furthest round they were seated in
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id),
  UNIQUE (tournament_id, place)
);
CREATE INDEX tournament_results_player_id_idx ON tournament_results (player_id);
