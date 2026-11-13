-- Invite links run out 24 hours after they are made (Erdin, 2026-11-13). Asking for a link after that makes a
-- new one. Links made before get 24 hours from when they were made.

ALTER TABLE room_invites ADD COLUMN expires_at timestamptz;

UPDATE room_invites
SET expires_at = created_at + interval '24 hours';

ALTER TABLE room_invites
  ALTER COLUMN expires_at SET NOT NULL,
  ADD CONSTRAINT room_invites_expires_check CHECK (expires_at > created_at);

-- Roll back:
--   ALTER TABLE room_invites DROP COLUMN expires_at;
