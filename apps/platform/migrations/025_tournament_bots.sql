-- Bots fill a tournament's tables (Erdin 2026-11-13). In sign-up's last minute, when at least one person signed
-- up, the platform signs bot accounts (players.is_bot) up until every table is full (and at least the minimum,
-- never past the maximum). Bots are treated as players: they pay the fee and win prizes. A bot short of coins for
-- the fee gets just enough first ('bot_funding'). bots_added_at keeps it to once per tournament.
-- Rollback (the CHECK fails while 'bot_funding' rows exist):
--   ALTER TABLE tournaments DROP COLUMN bots_added_at;
--   ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_reason_check;
--   ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_reason_check CHECK (reason IN ('signup_bonus', 'admin_grant',
--     'admin_take', 'tournament_fee', 'tournament_refund', 'tournament_prize'));

ALTER TABLE tournaments ADD COLUMN bots_added_at timestamptz;

ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_reason_check;
ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_reason_check CHECK (reason IN (
  'signup_bonus', 'admin_grant', 'admin_take',
  'tournament_fee', 'tournament_refund', 'tournament_prize',
  'bot_funding'));
