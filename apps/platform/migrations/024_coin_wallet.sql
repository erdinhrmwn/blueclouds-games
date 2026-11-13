-- Coin wallet (docs/plans/coin-wallet.md, Erdin 2026-11-13). Virtual coins only: they can't be bought or cashed
-- out. Every change of a balance is one ledger row written in the same transaction as the balance, and no balance
-- goes below zero. Coins come from an account's sign-up bonus, admin grants and tournament prizes; tournament fees
-- spend them and are refunded while the player hasn't played.

CREATE TABLE wallets (
  player_id   uuid PRIMARY KEY REFERENCES players(id),
  balance     bigint NOT NULL DEFAULT 0 CONSTRAINT wallets_balance_check CHECK (balance >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What happened to whose coins and why. History: never changed or deleted.
CREATE TABLE coin_ledger (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  player_id      uuid NOT NULL REFERENCES players(id),
  amount         bigint NOT NULL CHECK (amount <> 0),
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  reason         text NOT NULL CONSTRAINT coin_ledger_reason_check CHECK (reason IN (
                   'signup_bonus', 'admin_grant', 'admin_take',
                   'tournament_fee', 'tournament_refund', 'tournament_prize')),
  tournament_id  uuid REFERENCES tournaments(id),
  admin_id       uuid REFERENCES admins(id),
  note           text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 200 AND note = btrim(note))),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Tournament reasons name their tournament; admin reasons name their admin and say why.
  CONSTRAINT coin_ledger_tournament_check
    CHECK ((reason LIKE 'tournament_%') = (tournament_id IS NOT NULL)),
  CONSTRAINT coin_ledger_admin_check
    CHECK ((reason LIKE 'admin_%') = (admin_id IS NOT NULL AND note IS NOT NULL))
);
CREATE INDEX coin_ledger_player_id_idx ON coin_ledger (player_id, id DESC);
CREATE INDEX coin_ledger_tournament_id_idx ON coin_ledger (tournament_id) WHERE tournament_id IS NOT NULL;
-- One sign-up bonus per player, one prize per player per tournament: a retried request can't pay twice.
CREATE UNIQUE INDEX coin_ledger_signup_once ON coin_ledger (player_id) WHERE reason = 'signup_bonus';
CREATE UNIQUE INDEX coin_ledger_prize_once ON coin_ledger (tournament_id, player_id) WHERE reason = 'tournament_prize';
CREATE TRIGGER coin_ledger_append_only BEFORE UPDATE OR DELETE ON coin_ledger FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- What a sign-up paid, so leaving gives back exactly that (0 = nothing to give back).
ALTER TABLE tournament_players
  ADD COLUMN fee_paid bigint NOT NULL DEFAULT 0 CONSTRAINT tournament_players_fee_paid_check CHECK (fee_paid >= 0);

-- Prizes go out when an admin approves them, once.
ALTER TABLE tournaments
  ADD COLUMN prizes_paid_at timestamptz,
  ADD COLUMN prizes_paid_by_admin_id uuid REFERENCES admins(id),
  ADD CONSTRAINT tournaments_prizes_paid_check
    CHECK ((prizes_paid_at IS NULL) = (prizes_paid_by_admin_id IS NULL));

ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
-- A new action is added here and in the backoffice's AuditAction type.
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
  'login', 'login_failed', 'logout',
  'player.disable', 'player.enable', 'player.vip_grant', 'player.vip_revoke', 'player.coins_adjust',
  'tournament.create', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute',
  'tournament.disqualify', 'tournament.payout',
  'room.assign', 'room.unassign', 'room.kick', 'room.terminate',
  'admin.create', 'admin.disable', 'admin.enable', 'admin.password_reset', 'admin.role_change',
  'admin.password_change',
  'game.maintenance_start', 'game.maintenance_end'));

-- Rollback (the CHECK fails while rows with the new actions exist):
--   ALTER TABLE tournaments DROP CONSTRAINT tournaments_prizes_paid_check,
--     DROP COLUMN prizes_paid_by_admin_id, DROP COLUMN prizes_paid_at;
--   ALTER TABLE tournament_players DROP COLUMN fee_paid;
--   DROP TABLE coin_ledger, wallets;
--   ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
--   then add the CHECK from 013_tournament_player_status.sql again.
