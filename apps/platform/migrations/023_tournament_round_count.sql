-- How many rounds an Arena or Swiss tournament plays (Erdin 2026-11-13: the admin picks, default 3). A knockout
-- plays until one player is left, so it keeps NULL, as do tournaments made before this.
-- Rollback: ALTER TABLE tournaments DROP COLUMN rounds;
ALTER TABLE tournaments
  ADD COLUMN rounds smallint
    CONSTRAINT tournaments_rounds_check CHECK (rounds IS NULL OR rounds BETWEEN 1 AND 20);
