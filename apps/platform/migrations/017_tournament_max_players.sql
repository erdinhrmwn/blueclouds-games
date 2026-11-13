-- How many players a tournament takes (Erdin 2026-11-13, lobby card "18 / 36 signed up"). Signing up, by a player
-- or an admin, is refused once it is full. Tournaments made before this keep NULL and take anyone.
-- Rollback: ALTER TABLE tournaments DROP COLUMN max_players;
ALTER TABLE tournaments
  ADD COLUMN max_players smallint
    CONSTRAINT tournaments_max_players_check
      CHECK (max_players IS NULL OR max_players BETWEEN players_per_room AND 10000);
