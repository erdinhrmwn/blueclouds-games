-- Admin roles, and admins managed from the backoffice. An owner manages admins; an admin runs players and
-- tournaments; a viewer only looks. root is always an owner. Managing an admin is audited with the admin it was
-- done to.

ALTER TABLE admins
  ADD COLUMN role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'viewer'));
UPDATE admins SET role = 'owner' WHERE username = 'root';
ALTER TABLE admins
  ADD CONSTRAINT admins_root_owner_check CHECK (username <> 'root' OR role = 'owner');

ALTER TABLE admin_audit_events
  ADD COLUMN target_admin_id uuid REFERENCES admins(id),  -- the admin an admin.* action was done to
  DROP CONSTRAINT admin_audit_events_action_check,
  ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'login', 'login_failed', 'logout', 'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
    'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
    'room.assign', 'room.unassign',
    'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change')),
  ADD CONSTRAINT admin_audit_events_target_admin_check CHECK ((action LIKE 'admin.%') = (target_admin_id IS NOT NULL));

-- Roll back (admin.* audit rows stay as history, so the old action list comes back NOT VALID):
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_target_admin_check,
--     DROP CONSTRAINT admin_audit_events_action_check,
--     ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN ('login', 'login_failed', 'logout', 'player.disable',
--       'player.enable', 'player.vip_grant', 'player.vip_revoke', 'tournament.create', 'tournament.cancel',
--       'tournament.register', 'tournament.unregister', 'tournament.distribute', 'room.assign', 'room.unassign')) NOT VALID,
--     DROP COLUMN target_admin_id;
--   ALTER TABLE admins DROP CONSTRAINT admins_root_owner_check, DROP COLUMN role;
--   DELETE FROM schema_migrations WHERE name = '016_admin_management.sql';
