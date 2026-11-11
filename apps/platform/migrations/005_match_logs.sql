-- Every move of a match, for replay and audit (docs/architecture/match-log.md).
-- One row per match; `events` is the array the room sent, holding every hand and the deck order.
CREATE TABLE match_logs (
  match_id     uuid PRIMARY KEY REFERENCES matches(id),
  log_version  int NOT NULL,
  event_count  int NOT NULL,
  events       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER match_logs_updated_at BEFORE UPDATE ON match_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
