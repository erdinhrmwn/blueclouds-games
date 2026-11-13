-- Admins change their own password, kick a player off a live table and terminate a table. Widens CHECKs and adds
-- one column with a default: no existing row changes meaning.

-- A match an admin stopped by terminating its table: placed by the standings then, and it counts no win.
ALTER TABLE matches
  ADD COLUMN end_reason text NOT NULL DEFAULT 'finished' CHECK (end_reason IN ('finished', 'terminated'));

-- A tournament table an admin terminated.
ALTER TABLE rooms DROP CONSTRAINT rooms_close_reason_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_close_reason_check
  CHECK (close_reason IN ('finished', 'not_enough_players', 'terminated'));

ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
-- A new action is added here and in the backoffice's AuditAction type.
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
  'login', 'login_failed', 'logout',
  'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
  'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
  'room.assign', 'room.unassign', 'room.kick', 'room.terminate',
  'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change',
  'admin.password_change'));

-- Roll back (the CHECKs fail while rows with the new values exist):
--   ALTER TABLE matches DROP COLUMN end_reason;
--   ALTER TABLE rooms DROP CONSTRAINT rooms_close_reason_check;
--   ALTER TABLE rooms ADD CONSTRAINT rooms_close_reason_check CHECK (close_reason IN ('finished', 'not_enough_players'));
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
--   ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
--     'login', 'login_failed', 'logout',
--     'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
--     'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
--     'room.assign', 'room.unassign',
--     'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change'));
