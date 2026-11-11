# Generic match schema

Status: **built** (migration `006_generic_matches.sql`). Agreed with Erdin on 2026-11-11. The full, current schema with all its checks is in [database.md](database.md).

Goal: one set of tables that every game (Bust 31, Cloudburst, and later ones) reports into without a schema change. A new game adds one row to `games`; everything game-specific lives in two places only: the meaning of `score`, and the move log's `data`.

## Tables

```sql
-- The catalog. Adding a game = one migration that inserts its row.
CREATE TABLE games (
  slug         text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  name         text NOT NULL,                       -- "Bust 31"
  min_players  smallint NOT NULL CHECK (min_players >= 1),
  max_players  smallint NOT NULL CHECK (max_players BETWEEN min_players AND 32),
  score_label  text NOT NULL,                       -- what match_players.score means: "Lives left", "Points"
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One finished match. Unchanged, except game_slug now references games.
CREATE TABLE matches (
  id             uuid PRIMARY KEY,                  -- UUIDv7 from the room: the idempotency key
  game_slug      text NOT NULL REFERENCES games(slug),
  room_id        uuid NOT NULL REFERENCES rooms(id),  -- was room_code until 009; the report still sends roomCode
  rules_version  int  NOT NULL,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL,
  body_hash      bytea NOT NULL,
  created_at, updated_at
);

-- One seat of a match: who sat there and how they finished.
CREATE TABLE match_players (
  match_id    uuid NOT NULL REFERENCES matches(id),
  seat        smallint NOT NULL,
  player_id   uuid REFERENCES players(id),          -- null = bot
  bot_name    text,
  placement   smallint NOT NULL CHECK (placement >= 1),  -- 1 = winner; ranking always uses this
  score       int NOT NULL,                         -- game-defined final number (Bust 31: lives left, Cloudburst: points)
  created_at, updated_at,
  PRIMARY KEY (match_id, seat),
  CHECK ((player_id IS NULL) = (bot_name IS NOT NULL))   -- a seat is a player or a named bot
);

-- Every move of the match (match-log.md). Already built.
CREATE TABLE match_logs (
  match_id     uuid PRIMARY KEY REFERENCES matches(id),
  log_version  int NOT NULL,
  event_count  int NOT NULL,
  events       jsonb NOT NULL,                      -- [{seq, t, type, seat?, data?}], data is game-defined
  created_at, updated_at
);
```

## Rules every game follows

| What | Rule |
|---|---|
| Who won | `placement`: exactly one seat is 1; others may share a place. Higher/lower score never decides rank by itself. |
| Score | One integer per seat, meaning set by the game (`games.score_label`). Bust 31 = lives left (higher is better), Cloudburst = points (lower is better). |
| Rounds | A multi-round game sends one report per match. Rounds only appear in the move log. |
| Moves | Required log with the shared envelope; `type` and `data` are the game's own. |
| Seat limits | Read from `games` (replaces the `GAMES` map in `apps/platform/src/games.ts`). |

## What changed

1. New `games` table, seeded with `bust-31` (2–6, "Lives left"). Cloudburst inserts its own row when it ships.
2. `matches.game_slug` gets a foreign key to `games`.
3. `match_players.lives_left` becomes `score int` (the Cloudburst branch's rename, folded in here), and a seat must be either a player or a named bot.
4. Platform reads seat limits from `games`; backoffice shows `games.name` and `score_label` instead of a label map in code.
5. One migration (`006_generic_matches.sql`) after `005_match_logs.sql`. Existing rows only need the rename; an old bot seat without a name gets "Bot".

## Left out on purpose

- Per-seat extra stats (`jsonb`): everything is in the move log; add a column when a screen needs it.
- Match settings/variants: `rules_version` covers them while every game has fixed rules.
- Teams, draws (no winner), abandoned matches: no game has them yet.
- One row per move event: the jsonb array is enough to replay and audit one match; a per-event table can be filled from it later if cross-match queries are needed.
