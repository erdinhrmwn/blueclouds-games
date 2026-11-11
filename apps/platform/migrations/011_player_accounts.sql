-- Player accounts (Erdin, 2026-11-11): a guest can register a username and password and sign in on any
-- device. Guests stay; registering upgrades the guest in place, so their history stays theirs.
-- Plus three flags: is_active (derived from disabled_at), is_bot (a system-run account), is_vip.

ALTER TABLE players
  ADD COLUMN username      text UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),  -- stored lowercase; null = guest
  ADD COLUMN password_hash text CHECK (password_hash LIKE '$argon2id$%'),
  ADD COLUMN is_active     boolean NOT NULL GENERATED ALWAYS AS (disabled_at IS NULL) STORED,  -- disabled_at stays the source
  ADD COLUMN is_bot        boolean NOT NULL DEFAULT false,
  ADD COLUMN is_vip        boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT players_account_check CHECK ((username IS NULL) = (password_hash IS NULL));

ALTER TABLE admin_audit_events
  DROP CONSTRAINT admin_audit_events_action_check,
  ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'login', 'login_failed', 'logout', 'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
    'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
    'room.assign', 'room.unassign'));

-- Roll back (VIP audit rows stay as history, so the old action list comes back NOT VALID):
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check,
--     ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN ('login', 'login_failed', 'logout', 'player.disable', 'player.enable',
--       'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
--       'room.assign', 'room.unassign')) NOT VALID;
--   ALTER TABLE players DROP CONSTRAINT players_account_check,
--     DROP COLUMN is_vip, DROP COLUMN is_bot, DROP COLUMN is_active, DROP COLUMN password_hash, DROP COLUMN username;
