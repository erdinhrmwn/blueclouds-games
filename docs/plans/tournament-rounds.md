# Plan: tournament automation (rounds, standings, winners)

Status: decisions made by Erdin 2026-11-13 (see the end). Branch `feat/tournament-rounds`, one PR per phase into `develop`.

## Where we are

Automatic today (the tournament job, every minute):

- Sign-up refuses new players once `max_players` are in.
- When sign-up closes: a tournament below `min_players` is cancelled (`cancel_reason`, audited); otherwise the registered players are shuffled and spread evenly over tables (`planRooms`).
- Each table starts by itself at `starts_at`, waits 3 minutes for late players, plays **one match**, reports it, and closes.
- A table nobody opened closes at `starts_at + 4 min`; the tournament ends when its last table closes.

Missing: everything after that first match. Format (Arena, Knockout, Swiss) is only a label, there is no next round, no standings across tables, no winner, and prizes and fee are display text and numbers only (no wallet).

## The idea in one paragraph

A tournament plays in **rounds**. A round is a set of tables that start together and each play one match (exactly what a tournament does today, so today's tournaments are round 1 of 1). When every table of a round has closed, the job reads the match results, updates the **standings**, and either opens the next round (new tables, seated by the format's rule, starting after a short break) or **finishes** the tournament (final places written once, winners shown, prizes listed per place). The three formats only differ in who plays the next round and how they are seated.

Erdin chose **Round** as the name, in the UI ("Round 2 of 3") and in the code. A round inside a match already exists (`match_rounds`, the Bust 31 / Cloudburst hands), so the tournament's are always prefixed: `tournament_rounds`, `rooms.tournament_round`, `tournamentRound`.

## Formats

| | Who plays round n+1 | How they are seated | How many rounds | Final places |
|---|---|---|---|---|
| **Arena** | everyone still in (not withdrawn or disqualified) | shuffled, like round 1 | fixed, set by the admin (default 3, decided) | most points; ties by wins, then best average placement |
| **Swiss** | everyone still in | by points: sorted, then cut into tables in order, so players on the same score meet | fixed, set by the admin (default 3) | same as Arena |
| **Knockout** | only each table's winner (placement 1) | shuffled | until one player is left | the champion, then the final table's order, then earlier exits (later round first, better placement first) |

Points per match (Arena and Swiss): by placement at the table, `table size - placement + 1` (a 6-player table gives 6, 5, 4, 3, 2, 1). Decided.

Edge cases the job handles:

- **A player doesn't show up** for a round (loses their seat after the 3-minute wait): Arena/Swiss score 0 for that round and stay in; Knockout: out.
- **A table closes with "not enough players"**: no match, no points; in Knockout nobody from that table advances.
- **Knockout leaves fewer than the game's minimum for the next table** (for example 1 winner): that player is the champion. If 0 (every table failed), the tournament ends with no champion and the reason is kept, like a cancel.
- **Odd sizes**: every round uses the existing `planRooms` (as even as possible, never below the game's minimum); a player who can't be seated gets a bye (Arena/Swiss: average points of that round, rounded down; Knockout: advances).
- **Withdraw / disqualify mid-tournament**: already exists per seat; they simply aren't seated in later rounds.

## Database (migrations 021+)

```sql
-- One row per round; round 1 is created by today's distribute step.
CREATE TABLE tournament_rounds (
  tournament_id  uuid NOT NULL REFERENCES tournaments(id),
  round          smallint NOT NULL CHECK (round BETWEEN 1 AND 20),
  starts_at      timestamptz NOT NULL,
  distributed_at timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  PRIMARY KEY (tournament_id, round)
);

ALTER TABLE tournaments
  ADD COLUMN rounds smallint CHECK (rounds IS NULL OR rounds BETWEEN 1 AND 20);  -- Arena/Swiss; NULL for Knockout (until one is left)

ALTER TABLE rooms ADD COLUMN tournament_round smallint;  -- NOT NULL when tournament_id is set (CHECK), FK (tournament_id, round) → tournament_rounds

-- A player sits at one table per round, not per tournament.
ALTER TABLE room_assignments ADD COLUMN tournament_round smallint;  -- backfilled to 1
-- UNIQUE (tournament_id, player_id) becomes UNIQUE (tournament_id, round, player_id)

-- Written once when a tournament finishes; what winners, prizes and stats read.
CREATE TABLE tournament_results (
  tournament_id  uuid NOT NULL REFERENCES tournaments(id),
  player_id      uuid NOT NULL REFERENCES players(id),
  place          smallint NOT NULL CHECK (place >= 1),
  points         int NOT NULL DEFAULT 0,
  wins           smallint NOT NULL DEFAULT 0,
  out_at_round   smallint,              -- Knockout: the round they lost; NULL for the champion and Arena/Swiss
  PRIMARY KEY (tournament_id, player_id),
  UNIQUE (tournament_id, place)
);
```

Backfill: every existing tournament room and assignment gets `round = 1`, and every distributed tournament gets a round-1 row (`starts_at` = the tournament's). Rollback drops the new tables and columns and restores the old unique constraint (only safe while no tournament has a second round; the migration says so).

Live standings during the tournament are computed from `match_players` joined through `rooms.tournament_round` (a query, not a table), so there is nothing to keep in sync.

## Platform

- **`distributeIn`** takes a round and a list of players (round 1: the registered players, as today) and writes `tournament_rounds` + rooms with their round.
- **The job gains one step**, after today's ones: for each tournament whose current round has every table closed, in its own savepoint:
  1. read the round's results (`match_players` by room),
  2. decide who plays next by format (functions above, pure and unit-tested like `planRooms`),
  3. either distribute round n+1 with `starts_at = now() + ROUND_BREAK` (3 minutes, decided), or finish: write `tournament_results`, set `ended_at`, audit `tournament.finish`.
  `endIfDone` stops ending the tournament when its last room closes; the job's finish step does it instead.
- **`GET /v1/tournaments/:id`** (new, player secret): the tournament as the lobby lists it plus its rounds, the live standings (top 20 and the caller's own row) and, once finished, the results. The Detail dialog reads this for running and finished tournaments.
- **`GET /v1/players/me/rooms`** already lists the player's tournament tables; it returns the current round's table only, with its round number.
- **`GET /v1/rooms/:code/seats`** (actor): `startsAt` comes from the room's round, not the tournament.

## Room actor (apps/server)

- Today the actor starts at the tournament's `starts_at`; it reads the round's instead (no other change to the start and 3-minute wait).
- **After the match**, a tournament table shows a result card instead of only closing: "You go on to round 2", "Round 2 starts in 2:00, your table is K7QXM [Go to table]" for players with a seat in the next round, or "You're out, finished 7th" / "Final standings when the tournament ends". The next table isn't known when the match ends (other tables may still be playing), so the card polls the platform (`GET /v1/players/me/rooms`) every few seconds until it appears.

## Web and backoffice

- **Lobby card and Detail**: a running tournament shows "Round 2 of 3" and a **Standings** section (rank, name, points/wins, or "out in round 1" for Knockout). A finished tournament shows its **winners** on the podium next to the prizes ("1st Rina, 2,000 coins + badge").
- **Your table** card in the carousel follows the current round.
- **Backoffice**: the form gets "Rounds" for Arena and Swiss; the tournament page shows each round with its tables, the live standings, and the final results. "Distribute now" stays for round 1 only.
- **FigCraft first**: round chip on the card, standings section in the Detail, the post-match card in the room, the winners podium.

## Phases

Each phase is shippable and keeps today's tournaments working.

1. **Rounds as data, one round** (no behaviour change): migrations, backfill, `distributeIn` writes round 1, rooms and assignments carry their round, the actor reads the round's start. Tests: existing tournament tests stay green; new schema tests for the per-round unique rule.
2. **Results and winners for one-round tournaments**: the finish step writes `tournament_results` from the single round (who is 1st with several tables: decision 4), `GET /v1/tournaments/:id`, winners on the Detail and in the backoffice. Tests: finish step on fixtures, idempotent when the job runs twice.
3. **Knockout**: next round from table winners, champion, edge cases above. Tests: pure `nextRound` cases (8 → 2 tables → 1 final → champion; byes; a failed table), plus one job run across two rounds.
4. **Arena and Swiss**: points, fixed round count, Swiss seating, tie-breaks. Tests: points and seating pure tests, a 3-round job run.
5. **Players across rounds**: the actor's post-match card with the next table, "Round n of m" and standings in the web, FigCraft mockups updated first.

Rough size: phase 1 and 2 about a day each, 3 and 4 a day or two each, 5 two days with its design. Every phase gets its own PR into `develop`.

## Decisions (Erdin, 2026-11-13)

1. Points per placement for Arena and Swiss: `table size - placement + 1`.
2. Break between rounds: 3 minutes.
3. Number of rounds for Arena and Swiss: the admin picks per tournament, default 3.
4. A one-round tournament with several tables: the table winners play a final round for 1st. A bracket view comes later.
5. Name: **Round**, not Round, in the UI and the code (prefixed `tournament_` where a match round could be meant).

## Not in this plan

- **Wallet** (charging the fee on Join, paying prizes): needs a ledger, an audit trail and a legal look. `tournament_results.place` and `tournament_prizes.place` are what a payout would join later.
- Spectating other tables and a bracket view for Knockout; both read the same rounds and results, so they can come later without schema changes.
