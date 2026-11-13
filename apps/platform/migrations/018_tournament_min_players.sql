-- The fewest players a tournament runs with (Erdin 2026-11-13). When sign-up closes with fewer registered, the
-- distribute job cancels it and keeps why in cancel_reason (an admin's cancel leaves it NULL). Tournaments made
-- before this keep NULL and run with whoever signed up.
-- Rollback: ALTER TABLE tournaments DROP COLUMN min_players, DROP COLUMN cancel_reason;
ALTER TABLE tournaments
  ADD COLUMN min_players smallint
    CONSTRAINT tournaments_min_players_check
      CHECK (min_players IS NULL OR (min_players >= 1 AND min_players <= coalesce(max_players, min_players))),
  ADD COLUMN cancel_reason text
    CONSTRAINT tournaments_cancel_reason_check
      CHECK (cancel_reason IS NULL OR (cancelled_at IS NOT NULL AND char_length(cancel_reason) BETWEEN 1 AND 200));
