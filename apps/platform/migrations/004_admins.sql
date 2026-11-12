-- Backoffice admins and their sessions. Only the backoffice app uses these; it connects with the same database
-- user as the platform. An owner manages admins, an admin runs players and tournaments, a viewer only looks.
-- root is always an owner and is never disabled.

CREATE TABLE admins (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  username       text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash  text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),  -- Bun.password
  role           text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'viewer')),
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_root_enabled_check CHECK (username <> 'root' OR disabled_at IS NULL),
  CONSTRAINT admins_root_owner_check CHECK (username <> 'root' OR role = 'owner')
);
CREATE TRIGGER admins_updated_at BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only sha256(token) is stored, like player secrets.
CREATE TABLE admin_sessions (
  token_hash  bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  admin_id    uuid NOT NULL REFERENCES admins(id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_sessions_expires_check CHECK (expires_at > created_at)
);
CREATE INDEX admin_sessions_admin_id_idx ON admin_sessions (admin_id);
CREATE TRIGGER admin_sessions_updated_at BEFORE UPDATE ON admin_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roll back:
--   DROP TABLE admin_sessions, admins;
