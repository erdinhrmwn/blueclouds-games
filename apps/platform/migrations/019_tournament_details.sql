-- What a lobby card and its Detail dialog show about a tournament (Erdin 2026-11-13): its format, a description,
-- the prize as text the admin writes, and the fee in coins (0 = free). There is no wallet, so neither is charged or
-- paid out here; the format is a label until matchmaking for it exists. Tournaments made before this keep NULL, and
-- a fee of 0.
-- Rollback: ALTER TABLE tournaments DROP COLUMN format, DROP COLUMN description, DROP COLUMN prize, DROP COLUMN fee;
ALTER TABLE tournaments
  ADD COLUMN format text
    CONSTRAINT tournaments_format_check CHECK (format IS NULL OR format IN ('arena', 'knockout', 'swiss')),
  ADD COLUMN description text
    CONSTRAINT tournaments_description_check
      CHECK (description IS NULL OR (char_length(description) BETWEEN 1 AND 1000 AND description = btrim(description))),
  ADD COLUMN prize text
    CONSTRAINT tournaments_prize_check
      CHECK (prize IS NULL OR (char_length(prize) BETWEEN 1 AND 60 AND prize = btrim(prize))),
  ADD COLUMN fee integer NOT NULL DEFAULT 0
    CONSTRAINT tournaments_fee_check CHECK (fee BETWEEN 0 AND 1000000000);
