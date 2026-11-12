-- Guests get a generated username too (Erdin, 2026-11-11): "Play as guest" is one button, the platform names the
-- guest "Guest 482193" with username "guest_482193". A guest is now a player without a password, and the
-- "guest" prefix is kept for guests so an account never looks like one.

ALTER TABLE players DROP CONSTRAINT players_account_check;

-- Existing guests keep their display name and get a username in the guest range.
UPDATE players p SET username = 'guest_' || (100000 + n.rn)
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM players WHERE username IS NULL AND NOT is_bot) n
WHERE p.id = n.id;

ALTER TABLE players
  ADD COLUMN is_guest boolean NOT NULL GENERATED ALWAYS AS (password_hash IS NULL AND NOT is_bot) STORED,
  ADD CONSTRAINT players_guest_username_check CHECK ((password_hash IS NULL) = (username LIKE 'guest%') OR is_bot);

-- Roll back (guest usernames go back to null first):
--   ALTER TABLE players DROP CONSTRAINT players_guest_username_check, DROP COLUMN is_guest;
--   UPDATE players SET username = NULL WHERE password_hash IS NULL;
--   ALTER TABLE players ADD CONSTRAINT players_account_check CHECK ((username IS NULL) = (password_hash IS NULL));
