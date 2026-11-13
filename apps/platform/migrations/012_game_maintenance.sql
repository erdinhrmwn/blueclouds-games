-- Game maintenance (Erdin, 2026-11-13): an admin pauses a game from the backoffice. While maintenance_at is set,
-- nobody opens a new table or tournament for it; tables already open play on. Starting and ending it are audited.

ALTER TABLE games ADD COLUMN maintenance_at timestamptz;

ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
-- A new action is added here and in the backoffice's AuditAction type.
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
  'login', 'login_failed', 'logout',
  'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
  'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
  'room.assign', 'room.unassign', 'room.kick', 'room.terminate',
  'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change',
  'admin.password_change',
  'game.maintenance_start', 'game.maintenance_end'));

-- Roll back (the CHECK fails while rows with the new actions exist):
--   ALTER TABLE games DROP COLUMN maintenance_at;
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
--   ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
--     'login', 'login_failed', 'logout',
--     'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
--     'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
--     'room.assign', 'room.unassign', 'room.kick', 'room.terminate',
--     'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change',
--     'admin.password_change'));
