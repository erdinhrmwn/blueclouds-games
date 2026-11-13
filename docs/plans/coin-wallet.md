# Plan: coin wallet (tournament fee and prizes)

Status: approved by Erdin 2026-11-14 ("coins are only for tournaments for now"); all four phases built on `feat/coin-wallet` in one PR.

## Decisions (Erdin, 2026-11-13)

1. **Virtual coins only.** They can't be bought or cashed out. No payment provider, no KYC. If coins ever cost real money, that is a separate project with a legal review (fees and prizes would then look like gambling).
2. **Where coins come from:** a sign-up bonus when an account is made (not for guests), prizes, and admin grants in the backoffice. No daily bonus.
3. **Refunds:** the fee comes back in full whenever the player hasn't played yet: they leave during sign-up, withdraw before their table starts, or the tournament is cancelled (by an admin, or automatically below its minimum).
4. **Prizes are paid when an admin approves:** the job writes the final places as today; the backoffice shows who gets what and an admin presses **Pay out prizes**.

Assumptions (easy to change): the sign-up bonus is **1,000 coins**; players an admin adds by pasting ids or seats by hand pay **no fee**; a **disqualified** player gets no refund.

## How coins are kept

One rule makes it safe: **every change of a balance is a ledger row, written in the same transaction as the balance**, and a balance can't go below zero.

```sql
-- Migration 024
CREATE TABLE wallets (
  player_id   uuid PRIMARY KEY REFERENCES players(id),
  balance     bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only: what happened to whose coins, and why.
CREATE TABLE coin_ledger (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  player_id      uuid NOT NULL REFERENCES players(id),
  amount         bigint NOT NULL CHECK (amount <> 0),          -- + in, - out
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  reason         text NOT NULL CHECK (reason IN (
                   'signup_bonus', 'admin_grant', 'admin_take',
                   'tournament_fee', 'tournament_refund', 'tournament_prize')),
  tournament_id  uuid REFERENCES tournaments(id),
  admin_id       uuid REFERENCES admins(id),
  note           text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 200),
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- One sign-up bonus per player, one prize per player per tournament.
CREATE UNIQUE INDEX coin_ledger_signup_once ON coin_ledger (player_id) WHERE reason = 'signup_bonus';
CREATE UNIQUE INDEX coin_ledger_prize_once ON coin_ledger (tournament_id, player_id) WHERE reason = 'tournament_prize';

ALTER TABLE tournament_players ADD COLUMN fee_paid bigint NOT NULL DEFAULT 0 CHECK (fee_paid >= 0);
ALTER TABLE tournaments
  ADD COLUMN prizes_paid_at timestamptz,
  ADD COLUMN prizes_paid_by_admin_id uuid REFERENCES admins(id);
-- New audit actions: 'player.coins_adjust', 'tournament.payout'.
```

One function moves coins (`services/coins.ts`, used by the platform and the backoffice): it locks the wallet row, checks the balance, writes the ledger row with `balance_after`, and updates the balance. Everything else calls it inside its own transaction, so a fee is never taken without the sign-up, a refund never without the leave, a prize never without `prizes_paid_at`.

## Flows

| When | Coins | Where |
|---|---|---|
| A guest becomes an account, or an account is made | +1,000 `signup_bonus`, once ever | platform `register` |
| Join a tournament with a fee | −fee `tournament_fee`; refused with "Not enough coins: you have 250, the fee is 500." | platform `joinTournament` |
| Leave during sign-up, or withdraw before the table starts | +fee_paid `tournament_refund` | platform `leaveTournament` |
| Tournament cancelled (admin or auto) | +fee_paid to everyone still owed | backoffice cancel, job `cancelIfShort` |
| Admin presses **Pay out prizes** on a finished tournament | +coins per place `tournament_prize` | backoffice, audited `tournament.payout` |
| Admin grants or takes coins (with a note) | ± `admin_grant` / `admin_take` | backoffice player page, audited `player.coins_adjust` |

Joining twice, double payout and a second bonus are all no-ops or refused by the unique indexes, so a retried request can't pay twice.

## API

- `GET /v1/players/me` gains `coins` (the balance).
- `GET /v1/players/me/coins?before=` the player's ledger, newest first, 50 a page.
- `POST /v1/tournaments/:id/registration` charges the fee; `409` with the shortfall when the balance is too low.
- Lobby and live lists gain `prizesPaid` for finished tournaments.

## Screens (FigCraft first)

- **Account pill** shows the balance next to the name; guests see "Make an account for 1,000 coins".
- **Join with a fee** opens a short confirm: "Join Night Owls for 100 coins? You have 1,250; 1,150 left after." Not enough coins: Join is off and the card says how many are missing.
- **Profile → Coins**: balance, and the history (bonus, fees, refunds, prizes, admin changes with their note).
- **Finished tournament**: podium shows "Paid" once prizes are out, "Prizes pending" before.
- **Backoffice**: player page has the balance, history and "Adjust coins"; a finished tournament's page lists each place, player and prize with **Pay out prizes** (once); the tournament list shows fees taken and prizes paid.

## Phases

1. **Ledger and bonus**: migration, `coins.ts`, sign-up bonus, balance in `/players/me`, history endpoint, backoffice view and adjust. Tests: balance never negative, ledger matches balance, bonus once.
2. **Fee and refunds**: charge on join, refund on leave/withdraw/cancel, the Join confirm in the web. Tests: every refund path, too few coins, retry safety.
3. **Prize payout**: backoffice Pay out, `prizesPaid` in the lobby, "Paid"/"Prizes pending" on the podium. Tests: paid once, only after the tournament finished, matches the prize list.
4. **Profile coins page and account pill**, from the FigCraft design.

## Not in this plan

Buying or cashing out coins, a daily bonus, coin leaderboards, paying fees for players an admin adds.
