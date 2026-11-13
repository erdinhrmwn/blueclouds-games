-- Tournament player status (Erdin, 2026-11-13). Before the tables are handed out, leaving still deletes the row.
-- After that a player can withdraw while their table hasn't started, and an admin can disqualify a player at any
-- time until the tournament ends. Either way the row stays, their seat is freed if the table hasn't started, and
-- they can't come back. Disqualifying is audited, with its reason kept here as well.

ALTER TABLE tournament_players
  ADD COLUMN status text NOT NULL DEFAULT 'registered'
    CONSTRAINT tournament_players_status_check CHECK (status IN ('registered', 'withdrawn', 'disqualified')),
  ADD COLUMN status_reason text,
  ADD COLUMN status_changed_at timestamptz,
  -- Only a disqualification has a reason, and it always has one.
  ADD CONSTRAINT tournament_players_status_reason_check CHECK (
    (status = 'disqualified') = (status_reason IS NOT NULL)
    AND (status_reason IS NULL OR (char_length(status_reason) BETWEEN 1 AND 200 AND status_reason = btrim(status_reason)))),
  ADD CONSTRAINT tournament_players_status_changed_check CHECK ((status = 'registered') = (status_changed_at IS NULL));

ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
-- A new action is added here and in the backoffice's AuditAction type.
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
  'login', 'login_failed', 'logout',
  'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
  'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
  'tournament.disqualify',
  'room.assign', 'room.unassign', 'room.kick', 'room.terminate',
  'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change',
  'admin.password_change',
  'game.maintenance_start', 'game.maintenance_end'));

-- Roll back (the CHECK fails while rows with the new action exist):
--   ALTER TABLE tournament_players DROP COLUMN status, DROP COLUMN status_reason, DROP COLUMN status_changed_at;
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
--   then add the CHECK from 012_game_maintenance.sql again.
