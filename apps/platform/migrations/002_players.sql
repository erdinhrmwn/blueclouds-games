CREATE TABLE players (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name    text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 20),
  disabled_at     timestamptz,
  disabled_reason text,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Only sha256(secret) is stored. The secret is 32 random bytes, so a slow hash adds nothing.
CREATE TABLE player_secrets (
  secret_hash  bytea PRIMARY KEY,
  player_id    uuid NOT NULL REFERENCES players(id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_secrets_player ON player_secrets (player_id);

CREATE TRIGGER players_updated_at BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER player_secrets_updated_at BEFORE UPDATE ON player_secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
