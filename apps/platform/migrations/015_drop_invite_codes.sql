-- Invite codes are gone (Erdin, 2026-11-12): a private table is shared only by its invite link. Codes are
-- deleted, and with them the columns only codes needed. A link stays valid until the opener resets it.
DELETE FROM room_invites WHERE kind = 'code';

-- The one-live-link index filters on `kind`; dropping `expires_at` also drops the check tying codes to it.
DROP INDEX room_invites_one_link_idx;
ALTER TABLE room_invites DROP COLUMN kind, DROP COLUMN expires_at;
CREATE UNIQUE INDEX room_invites_one_link_idx ON room_invites (room_id) WHERE revoked_at IS NULL;

-- Every link token is 16 random bytes as 32 lowercase hex characters.
ALTER TABLE room_invites DROP CONSTRAINT room_invites_secret_check;
ALTER TABLE room_invites ADD CONSTRAINT room_invites_secret_check CHECK (secret ~ '^[0-9a-f]{32}$');

-- Roll back (deleted codes don't come back; they expired within 10 minutes anyway):
--   ALTER TABLE room_invites DROP CONSTRAINT room_invites_secret_check;
--   ALTER TABLE room_invites ADD CONSTRAINT room_invites_secret_check CHECK (secret ~ '^[A-Za-z0-9]{6,64}$');
--   DROP INDEX room_invites_one_link_idx;
--   ALTER TABLE room_invites
--     ADD COLUMN kind text NOT NULL DEFAULT 'link' CHECK (kind IN ('link', 'code')),
--     ADD COLUMN expires_at timestamptz,
--     ADD CHECK ((kind = 'code') = (expires_at IS NOT NULL));
--   ALTER TABLE room_invites ALTER COLUMN kind DROP DEFAULT;
--   CREATE UNIQUE INDEX room_invites_one_link_idx ON room_invites (room_id)
--     WHERE kind = 'link' AND revoked_at IS NULL;
--   DELETE FROM schema_migrations WHERE name = '015_drop_invite_codes.sql';
