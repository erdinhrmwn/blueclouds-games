-- Players and their login secrets. A guest is a player without a password: "Play as guest" names them
-- "Guest 482193" with username "guest_482193". Registering upgrades the guest in place, so their history stays
-- theirs. Players are disabled, never deleted, except guests that never played (the daily sweep).

CREATE TABLE players (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name     text NOT NULL,
  username         text UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),  -- stored lowercase
  password_hash    text CHECK (password_hash LIKE '$argon2id$%'),          -- null = guest
  is_bot           boolean NOT NULL DEFAULT false,                          -- a system-run account
  is_vip           boolean NOT NULL DEFAULT false,
  is_guest         boolean NOT NULL GENERATED ALWAYS AS (password_hash IS NULL AND NOT is_bot) STORED,
  disabled_at      timestamptz,
  disabled_reason  text CHECK (char_length(disabled_reason) BETWEEN 1 AND 200),
  is_active        boolean NOT NULL GENERATED ALWAYS AS (disabled_at IS NULL) STORED,  -- disabled_at stays the source
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT players_display_name_check
    CHECK (char_length(display_name) BETWEEN 1 AND 20 AND display_name = btrim(display_name) AND display_name !~ '[[:cntrl:]]'),
  CONSTRAINT players_disabled_check CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL)),
  -- The "guest" prefix is kept for guests, so an account never looks like one.
  CONSTRAINT players_guest_username_check CHECK ((password_hash IS NULL) = (username LIKE 'guest%') OR is_bot)
);
-- The guest sweep's scan.
CREATE INDEX players_guest_last_seen_at_idx ON players (last_seen_at) WHERE is_guest;
CREATE TRIGGER players_updated_at BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only sha256(secret) is stored. The secret is 32 random bytes, so a slow hash adds nothing.
-- Deleting a guest takes its secrets with it.
CREATE TABLE player_secrets (
  secret_hash  bytea PRIMARY KEY CHECK (octet_length(secret_hash) = 32),
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_secrets_player_id_idx ON player_secrets (player_id);
CREATE TRIGGER player_secrets_updated_at BEFORE UPDATE ON player_secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roll back:
--   DROP TABLE player_secrets, players;
