-- Production hardening (docs/architecture/database.md): the database guards its own rules,
-- history and audit rows are append-only, indexes match the real queries, names are consistent.
-- ALTERs only: existing rows stay. If any row breaks a new rule, the whole migration rolls back.

-- History and audit rows are never edited. A future data fix says so with DISABLE TRIGGER.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

ALTER TABLE players
  DROP CONSTRAINT players_display_name_check,
  ADD CONSTRAINT players_display_name_check
    CHECK (char_length(display_name) BETWEEN 1 AND 20 AND display_name = btrim(display_name) AND display_name !~ '[[:cntrl:]]'),
  ADD CHECK (char_length(disabled_reason) BETWEEN 1 AND 200),
  ADD CONSTRAINT players_disabled_check CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL));

ALTER TABLE player_secrets ADD CHECK (octet_length(secret_hash) = 32);
ALTER INDEX player_secrets_player RENAME TO player_secrets_player_id_idx;

-- substr instead of uuid_extract_version(): the local test database is Postgres 16.
ALTER TABLE matches
  ADD CHECK (substr(id::text, 15, 1) = '7'),
  ADD CHECK (room_code ~ '^[A-Z0-9]{4,8}$'),
  ADD CHECK (rules_version >= 1),
  ADD CHECK (octet_length(body_hash) = 32),
  ADD CONSTRAINT matches_ended_check CHECK (ended_at >= started_at);
ALTER TABLE matches RENAME CONSTRAINT matches_game_fk TO matches_game_slug_fkey;
DROP INDEX matches_game_ended;
CREATE INDEX matches_game_slug_id_idx ON matches (game_slug, id DESC);
CREATE INDEX matches_ended_at_idx ON matches (ended_at);
CREATE TRIGGER matches_append_only BEFORE UPDATE OR DELETE ON matches FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE match_players
  ADD CHECK (seat BETWEEN 0 AND 31),
  ADD CHECK (placement BETWEEN 1 AND 32),
  ADD CHECK (char_length(bot_name) BETWEEN 1 AND 20),
  ADD CHECK (score BETWEEN -1000000 AND 1000000);
-- One seat per player per match; same columns as the history index it replaces.
DROP INDEX match_players_player;
CREATE UNIQUE INDEX match_players_player_id_match_id_key ON match_players (player_id, match_id DESC) WHERE player_id IS NOT NULL;
-- At most one winner. "At least one" stays in the API.
CREATE UNIQUE INDEX match_players_winner_key ON match_players (match_id) WHERE placement = 1;
CREATE TRIGGER match_players_append_only BEFORE UPDATE OR DELETE ON match_players FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE match_logs
  ADD CHECK (log_version >= 1),
  ADD CHECK (event_count BETWEEN 1 AND 5000),
  ADD CHECK (jsonb_typeof(events) = 'array'),
  ADD CONSTRAINT match_logs_events_length_check CHECK (event_count = jsonb_array_length(events));
CREATE TRIGGER match_logs_append_only BEFORE UPDATE OR DELETE ON match_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE admins
  ADD CHECK (password_hash LIKE '$argon2id$%'),
  ADD CONSTRAINT admins_root_enabled_check CHECK (username <> 'root' OR disabled_at IS NULL);

ALTER TABLE admin_sessions
  ADD CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT admin_sessions_expires_check CHECK (expires_at > created_at);
ALTER INDEX admin_sessions_admin RENAME TO admin_sessions_admin_id_idx;

-- The audit log: a plural name, a typed target, a fixed list of actions.
ALTER TABLE admin_audit RENAME TO admin_audit_events;
ALTER TABLE admin_audit_events RENAME CONSTRAINT admin_audit_pkey TO admin_audit_events_pkey;
ALTER TABLE admin_audit_events RENAME CONSTRAINT admin_audit_admin_id_fkey TO admin_audit_events_admin_id_fkey;
ALTER TABLE admin_audit_events RENAME COLUMN target_id TO player_id;
ALTER TABLE admin_audit_events
  ADD FOREIGN KEY (player_id) REFERENCES players(id),
  ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN ('login', 'login_failed', 'logout', 'player.disable', 'player.enable')),
  ADD CHECK (jsonb_typeof(detail) = 'object');
DROP INDEX admin_audit_created;  -- the audit screen pages by id
ALTER INDEX admin_audit_login_failed RENAME TO admin_audit_events_login_failed_idx;
ALTER TRIGGER admin_audit_updated_at ON admin_audit_events RENAME TO admin_audit_events_updated_at;
CREATE TRIGGER admin_audit_events_append_only BEFORE UPDATE OR DELETE ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Roll back (drops the new rules; no data is lost):
--   DROP TRIGGER admin_audit_events_append_only ON admin_audit_events;
--   ALTER TRIGGER admin_audit_events_updated_at ON admin_audit_events RENAME TO admin_audit_updated_at;
--   ALTER INDEX admin_audit_events_login_failed_idx RENAME TO admin_audit_login_failed;
--   CREATE INDEX admin_audit_created ON admin_audit_events (created_at DESC);
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_detail_check, DROP CONSTRAINT admin_audit_events_action_check,
--     DROP CONSTRAINT admin_audit_events_player_id_fkey;
--   ALTER TABLE admin_audit_events RENAME COLUMN player_id TO target_id;
--   ALTER TABLE admin_audit_events RENAME CONSTRAINT admin_audit_events_admin_id_fkey TO admin_audit_admin_id_fkey;
--   ALTER TABLE admin_audit_events RENAME CONSTRAINT admin_audit_events_pkey TO admin_audit_pkey;
--   ALTER TABLE admin_audit_events RENAME TO admin_audit;
--   ALTER INDEX admin_sessions_admin_id_idx RENAME TO admin_sessions_admin;
--   ALTER TABLE admin_sessions DROP CONSTRAINT admin_sessions_expires_check, DROP CONSTRAINT admin_sessions_token_hash_check;
--   ALTER TABLE admins DROP CONSTRAINT admins_root_enabled_check, DROP CONSTRAINT admins_password_hash_check;
--   DROP TRIGGER match_logs_append_only ON match_logs;
--   ALTER TABLE match_logs DROP CONSTRAINT match_logs_events_length_check, DROP CONSTRAINT match_logs_events_check,
--     DROP CONSTRAINT match_logs_event_count_check, DROP CONSTRAINT match_logs_log_version_check;
--   DROP TRIGGER match_players_append_only ON match_players;
--   DROP INDEX match_players_winner_key, match_players_player_id_match_id_key;
--   CREATE INDEX match_players_player ON match_players (player_id, match_id DESC) WHERE player_id IS NOT NULL;
--   ALTER TABLE match_players DROP CONSTRAINT match_players_seat_check, DROP CONSTRAINT match_players_placement_check,
--     DROP CONSTRAINT match_players_bot_name_check, DROP CONSTRAINT match_players_score_check;
--   DROP TRIGGER matches_append_only ON matches;
--   DROP INDEX matches_game_slug_id_idx, matches_ended_at_idx;
--   CREATE INDEX matches_game_ended ON matches (game_slug, ended_at DESC);
--   ALTER TABLE matches RENAME CONSTRAINT matches_game_slug_fkey TO matches_game_fk;
--   ALTER TABLE matches DROP CONSTRAINT matches_id_check, DROP CONSTRAINT matches_room_code_check, DROP CONSTRAINT matches_rules_version_check,
--     DROP CONSTRAINT matches_body_hash_check, DROP CONSTRAINT matches_ended_check;
--   ALTER INDEX player_secrets_player_id_idx RENAME TO player_secrets_player;
--   ALTER TABLE player_secrets DROP CONSTRAINT player_secrets_secret_hash_check;
--   ALTER TABLE players DROP CONSTRAINT players_disabled_check, DROP CONSTRAINT players_disabled_reason_check, DROP CONSTRAINT players_display_name_check,
--     ADD CONSTRAINT players_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 20);
--   DROP FUNCTION forbid_change();
