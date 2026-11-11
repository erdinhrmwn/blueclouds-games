-- Guest cleanup (Erdin, 2026-11-11): a guest that never played a match is deleted when it logs out, or by the
-- platform's daily sweep after 30 days unseen. Its login secrets go with it, and rooms it opened forget who did.
-- Anything that is history (match_players, tournament sign-ups and seats, admin audit) keeps NO ACTION, so the
-- database itself refuses to delete a guest that appears there.

ALTER TABLE player_secrets
  DROP CONSTRAINT player_secrets_player_id_fkey,
  ADD CONSTRAINT player_secrets_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE rooms
  DROP CONSTRAINT rooms_created_by_player_id_fkey,
  ADD CONSTRAINT rooms_created_by_player_id_fkey FOREIGN KEY (created_by_player_id) REFERENCES players(id) ON DELETE SET NULL;

-- The sweep's scan, and the SET NULL lookup on delete.
CREATE INDEX players_guest_last_seen_at_idx ON players (last_seen_at) WHERE is_guest;
CREATE INDEX rooms_created_by_player_id_idx ON rooms (created_by_player_id) WHERE created_by_player_id IS NOT NULL;

-- Roll back:
--   DROP INDEX rooms_created_by_player_id_idx, players_guest_last_seen_at_idx;
--   ALTER TABLE rooms DROP CONSTRAINT rooms_created_by_player_id_fkey,
--     ADD CONSTRAINT rooms_created_by_player_id_fkey FOREIGN KEY (created_by_player_id) REFERENCES players(id);
--   ALTER TABLE player_secrets DROP CONSTRAINT player_secrets_player_id_fkey,
--     ADD CONSTRAINT player_secrets_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);
