-- The admin audit log: every sign-in and change in the backoffice, with what it was done to. Append-only.

CREATE TABLE admin_audit_events (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  admin_id         uuid REFERENCES admins(id),        -- null for a failed sign-in
  action           text NOT NULL,
  player_id        uuid REFERENCES players(id),
  tournament_id    uuid REFERENCES tournaments(id),
  room_id          uuid REFERENCES rooms(id),
  target_admin_id  uuid REFERENCES admins(id),        -- the admin an admin.* action was done to
  detail           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
  ip               inet,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A new action is added here and in the backoffice's AuditAction type.
  CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'login', 'login_failed', 'logout',
    'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke',
    'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
    'room.assign', 'room.unassign',
    'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change')),
  CONSTRAINT admin_audit_events_target_admin_check CHECK ((action LIKE 'admin.%') = (target_admin_id IS NOT NULL))
);
-- Sign-in lockout counts recent failures per username. The audit screen pages by id.
CREATE INDEX admin_audit_events_login_failed_idx ON admin_audit_events ((detail->>'username'), created_at DESC)
  WHERE action = 'login_failed';
CREATE TRIGGER admin_audit_events_updated_at BEFORE UPDATE ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_audit_events_append_only BEFORE UPDATE OR DELETE ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Roll back:
--   DROP TABLE admin_audit_events;
