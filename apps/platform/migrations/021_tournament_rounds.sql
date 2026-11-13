-- Tournament rounds (docs/plans/tournament-rounds.md, Erdin 2026-11-13). A tournament plays in rounds: a round is a
-- set of tables that start together and each play one match. Every tournament so far is round 1 of 1, and this
-- migration only makes that explicit; later rounds come with the job that opens them. "Round" is always prefixed
-- tournament_ here, since match_rounds are the hands inside one match.

CREATE TABLE tournament_rounds (
  tournament_id   uuid NOT NULL REFERENCES tournaments(id),
  round           smallint NOT NULL CHECK (round BETWEEN 1 AND 20),
  starts_at       timestamptz NOT NULL,                    -- when its tables start by themselves
  distributed_at  timestamptz NOT NULL DEFAULT now(),      -- when its tables were handed out
  ended_at        timestamptz,                             -- when its last table closed
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round)
);
CREATE TRIGGER tournament_rounds_updated_at BEFORE UPDATE ON tournament_rounds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every tournament that has tables gets its round 1, starting when the tournament does.
INSERT INTO tournament_rounds (tournament_id, round, starts_at, distributed_at, ended_at)
SELECT
  t.id,
  1,
  t.starts_at,
  coalesce(t.distributed_at, min(r.created_at)),
  t.ended_at
FROM tournaments t
JOIN rooms r ON r.tournament_id = t.id
GROUP BY t.id;

-- A tournament table belongs to one round.
ALTER TABLE rooms ADD COLUMN tournament_round smallint;
UPDATE rooms SET tournament_round = 1 WHERE tournament_id IS NOT NULL;
ALTER TABLE rooms
  ADD CONSTRAINT rooms_tournament_round_check CHECK ((tournament_id IS NULL) = (tournament_round IS NULL)),
  ADD CONSTRAINT rooms_tournament_round_fkey
    FOREIGN KEY (tournament_id, tournament_round) REFERENCES tournament_rounds(tournament_id, round),
  ADD CONSTRAINT rooms_id_tournament_round_key UNIQUE (id, tournament_id, tournament_round);

-- A player sits at one table per round, no longer one per tournament.
ALTER TABLE room_assignments ADD COLUMN tournament_round smallint;
UPDATE room_assignments ra SET tournament_round = r.tournament_round FROM rooms r WHERE r.id = ra.room_id;
ALTER TABLE room_assignments
  ALTER COLUMN tournament_round SET NOT NULL,
  DROP CONSTRAINT room_assignments_room_id_tournament_id_fkey,
  ADD CONSTRAINT room_assignments_room_round_fkey
    FOREIGN KEY (room_id, tournament_id, tournament_round) REFERENCES rooms(id, tournament_id, tournament_round),
  DROP CONSTRAINT room_assignments_tournament_id_player_id_key,
  ADD CONSTRAINT room_assignments_round_player_key UNIQUE (tournament_id, tournament_round, player_id);

-- Rollback (only while no tournament has a round 2, or the old one-table-per-tournament rule fails):
--   ALTER TABLE room_assignments
--     DROP CONSTRAINT room_assignments_round_player_key,
--     DROP CONSTRAINT room_assignments_room_round_fkey,
--     ADD CONSTRAINT room_assignments_tournament_id_player_id_key UNIQUE (tournament_id, player_id),
--     ADD CONSTRAINT room_assignments_room_id_tournament_id_fkey
--       FOREIGN KEY (room_id, tournament_id) REFERENCES rooms(id, tournament_id),
--     DROP COLUMN tournament_round;
--   ALTER TABLE rooms
--     DROP CONSTRAINT rooms_id_tournament_round_key,
--     DROP CONSTRAINT rooms_tournament_round_fkey,
--     DROP CONSTRAINT rooms_tournament_round_check,
--     DROP COLUMN tournament_round;
--   DROP TABLE tournament_rounds;
