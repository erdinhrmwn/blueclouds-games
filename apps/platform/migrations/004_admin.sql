-- Backoffice: admins, their sessions and the audit log. Only the backoffice app uses these;
-- it connects with the same database user as the platform.
CREATE TABLE admins (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  username       text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash  text NOT NULL,  -- Bun.password (argon2id)
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Only sha256(token) is stored, like player secrets.
CREATE TABLE admin_sessions (
  token_hash  bytea PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admins(id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin ON admin_sessions (admin_id);

CREATE TABLE admin_audit (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  admin_id    uuid REFERENCES admins(id),  -- null for a failed login
  action      text NOT NULL,               -- 'login', 'login_failed', 'logout', 'player.disable', 'player.enable'
  target_id   uuid,
  detail      jsonb NOT NULL DEFAULT '{}',
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON admin_audit (created_at DESC);
-- Login lockout counts recent failures per username.
CREATE INDEX admin_audit_login_failed ON admin_audit ((detail->>'username'), created_at DESC) WHERE action = 'login_failed';

CREATE TRIGGER admins_updated_at BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_sessions_updated_at BEFORE UPDATE ON admin_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_audit_updated_at BEFORE UPDATE ON admin_audit FOR EACH ROW EXECUTE FUNCTION set_updated_at();

