# Match log

Status: **built** for Bust 31 (room, platform, backoffice). Decided with Erdin on 2026-11-11: replay is backoffice only for now, as a timeline with a step slider.

Every game records every move of every match, so a match can be replayed and audited later. Today the platform only stores the result (`matches`, `match_players`).

## Goals

- **Replay**: rebuild the table at any step of a finished match, from the first deal to the winner.
- **Audit**: answer "what happened?" for a dispute or a suspected bug: who played what, when, and whether the server or the player made the move.
- **Generic**: the platform and backoffice store and list any game's log without knowing its rules. Only the game (and an optional backoffice renderer) understands its own events.

Not in scope now: a replay screen for players, live spectating, cross-match queries ("every timeout by player X").

## Why not a Rivet feature

Rivet has no built-in move history, audit log or export (checked Nov 2026):

- **Workflows "replay"** re-runs recorded steps after a crash. That is recovery, not a game replay.
- **Inspector / debugging** endpoints are developer tools with no action history.
- **Actor SQLite** is durable and is where the room records moves (below), but it lives per room, a room hosts many matches, and nothing in it is queryable by the backoffice.
- **Durable Streams** (append-only log with replay from an offset) comes closest, but it is another service to run, streams can expire or be deleted, and we would still copy everything to Postgres.

So the room uses its own SQLite while the match runs, and Postgres is the record.

## Event format

A log is an ordered list of events, sent with the match result:

```json
{
  "logVersion": 1,
  "events": [
    { "seq": 0, "t": 0,    "type": "deal",  "data": { "round": 1, "starter": 2, "hands": { "0": ["n7-1", "m-0", "n3-2"], "2": ["…"] }, "deck": ["n9-0", "…"] } },
    { "seq": 1, "t": 4120, "type": "play",  "seat": 2, "data": { "card": "n7-1", "total": 7, "drew": "n9-0", "by": "player" } },
    { "seq": 2, "t": 9800, "type": "bust",  "seat": 0, "data": { "card": "n8-3", "total": 33, "lives": 2, "eliminated": false, "by": "timeout" } }
  ]
}
```

Envelope (the same for every game, checked by the platform):

| Field | Meaning |
|---|---|
| `seq` | 0, 1, 2… with no gaps. Order of the log. |
| `t` | Milliseconds since `startedAt`, 0 or more (the room's clock; if it ever steps back, events can share a time). |
| `type` | Game-defined, `[a-z_]{1,32}`. |
| `seat` | Who acted, as a seat in the match's `players`. Missing for server events (a deal). Seats, not player ids, because bots have no id. |
| `data` | Game-defined JSON object. |

`logVersion` versions the envelope and each game's event shapes; `rulesVersion` (already sent) versions the rules.

### Bust 31 events

| Type | Seat | Data |
|---|---|---|
| `deal` | — | `round`, `starter` (seat), `hands` (seat → card ids), `deck` (card ids, top first) |
| `play` | player | `card`, `total` after, `drew` (card id or null), `by` |
| `bust` | player | `card`, `total` after, `lives` left, `eliminated`, `by` |
| `reshuffle` | — | `deck` (new order, top first), when the deck ran out mid-round |
| `away` / `back` | player | — (closed the tab / came back) |
| `kicked` | player | `by` (`admin` or `host`), `reason` (admin only); their turns are played for them from here |
| `finished` | — | `winner` (seat) |
| `terminated` | — | `by` (`admin`), `reason`; always the last event of a match an admin stopped (no `finished`) |

`by` is `player` (they chose), `timeout` (their 20 s ran out), `away` (played for an absent player) or `bot`.

Card ids already say what the card is (`n7-1` = number 7, `z` zero, `m` −5, `r` reverse), so events stay small. Every random outcome (deal and reshuffle order) is in the log, so a replay never needs the random generator. Server outcomes (`total`, `lives`) are stored too: a replay recomputes them and flags any step where they disagree, which is exactly what an audit wants to catch.

The events are derived in a pure function, `logEvents(before, after, auto)` in the game's `match.ts`, from the state change of each commit. `rules.ts` does not change.

## Hidden information

The log holds every hand and the deck order, so it must never reach a player while the match runs.

- The room keeps the log in its own SQLite; it never goes into the view or a hand sent to clients.
- It leaves the room only inside the finished match's report, server to server.
- The platform exposes it only to the backoffice. `GET /v1/players/me/matches` does not return it.
- If players later get a replay of their own matches, the match is over by then, so showing every hand is fine. That is a separate change.

## Recording in the room

A new table in the room's SQLite, appended on each commit:

```sql
CREATE TABLE match_events (match_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (match_id, seq));
```

One small INSERT per move (not a rewrite of the room row), so a long match costs the same per move as a short one, and a crash keeps everything up to the last commit. When the game finishes, the report and its events are written to the `match_reports` outbox in the same step as today, and the `match_events` rows for that match are deleted.

## Shipping to the platform

The log rides in the existing `POST /v1/matches` body as `log: { logVersion, events }`. One request, one transaction, and the existing idempotency hash covers the events too (a retry is identical; a changed log is a 409). No chunking: a 6-player Bust 31 match is about 160 plays and 17 deals (500 simulated bot games, max 201 plays), roughly 25 KB of JSON.

Limits:
- `POST /v1/matches` body up to **512 KB** (every other route keeps 16 KB).
- At most **5,000 events**, each `data` up to 4 KB.
- The platform checks the envelope (`seq` without gaps from 0, `t` ≥ 0, `type` format, `seat` is one of the match's seats) and stores `data` as is.

A report without `log` is rejected (400): every game must send one. Nothing is deployed yet, so no old outbox rows need it to be optional.

## Storage

```sql
CREATE TABLE match_logs (
  match_id     uuid PRIMARY KEY REFERENCES matches(id),
  log_version  int  NOT NULL,
  event_count  int  NOT NULL,
  events       jsonb NOT NULL,   -- the array, as sent
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

One row per match, inserted in the same transaction as `matches`. A separate table keeps the match lists light; Postgres compresses the big `events` value out of line (TOAST). Kept forever, like match history: ~25 KB per match is about 2.5 GB per 100,000 matches before compression.

ponytail: one jsonb array per match is enough for replaying one match. If we ever need queries across matches ("all timeouts by player X"), add a `match_events` table (one row per event) filled from these rows.

## Backoffice

The match detail page gets a **Moves** section under the seats:

- A timeline table: step, time (`+m:ss`), player, what happened (e.g. "played 7 → 19", "busted with 8 → 33, 2 lives left, timed out").
- A step slider showing the table at that step: each hand, the total, lives, whose turn.
- A **Download JSON** link with the raw log, for a deeper look or a bug report.

Each game provides a small renderer in `apps/backoffice/src/lib/games/<slug>.ts` that turns events into lines and folds them into table states. A game without one falls back to the raw events (type, seat, data). Matches stored before this change show "No move log".

## Adding a game

`docs/adding-a-game.md` gets one step: record a log (events + `logEvents` in the game's `match.ts`), list the event types in `docs/games/<slug>/rules.md`, and optionally add a backoffice renderer.

## Checks to leave behind

- `logEvents`: a scripted Bust 31 game yields deal, play, bust, finished with the right seats, totals and `by`.
- Replaying a full simulated game's log reproduces the final lives and winner.
- Platform: a report with a log is stored with it; a retry is 200; a changed log is 409; a missing log, a gap in `seq`, a negative `t` or an unknown seat is 400; a body over 512 KB is 413.
- Backoffice: the replay of 20 random full games (built with the room's own code) never disagrees with the log; a tampered total is flagged; a match without a log loads as null.
