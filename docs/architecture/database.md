# Platform database

Status: **proposal**, waiting for Erdin's OK. Nothing here is built yet. Rooms (server-made codes) and tournaments (admin-made rooms with assigned players) added on Erdin's request.

This file is meant to become the one place that describes the platform's Postgres schema. Today the schema is spread over `platform-api.md` (its "Data store" section is out of date), `match-schema.md` and `match-log.md`, and parts of it are only enforced by Zod in the API, not by the database.

## Goal

Take the MVP schema (migrations `001`–`006`) to a level we can run in production without changing its shape. Same tables, same API, same conventions. The work is mostly making the database refuse bad data on its own, protecting the audit data, and fixing indexes so they match the real queries.

What "production level" means here:

1. **The database guards its own rules.** Anything the API checks with Zod that the database can check cheaply becomes a `CHECK`, `UNIQUE` or foreign key. The backoffice writes to Postgres directly with the same role as the platform, so Zod in one app is not a guard for the other.
2. **History cannot be edited.** Matches, seats, move logs and the admin audit log are append-only, enforced by a trigger. With one shared DB role, a trigger is the only thing that stops a buggy query from rewriting history.
3. **Every index serves a query we actually run**, and every query a screen runs has an index.
4. **Names follow one pattern**, so nobody has to guess.
5. **Rooms are made by the server and stored** (Erdin, 2026-11-11). The platform generates every room code, and each room is a row, so the backoffice can create a tournament with its rooms and put players straight into them.

Kept as is (Erdin's rules): Postgres 18, UUIDv7 ids, `created_at` + `updated_at` on every table with the `set_updated_at()` trigger, one DB role for platform and backoffice, a full move log per match, a new game = one row in `games`, match history kept forever.

## Conventions

| What | Rule |
|---|---|
| Tables | Plural `snake_case` nouns. A child table is `<parent>_<child>` (`player_secrets`, `match_players`). |
| Ids | `id uuid PRIMARY KEY DEFAULT uuidv7()`. Exceptions on purpose: `matches.id` is chosen by the room (the idempotency key), secret and session tables are keyed by the token hash, `games` by its slug. |
| Time | `timestamptz` only. A state change is a timestamp (`disabled_at`, `revoked_at`), not a boolean, so we know when it happened. |
| Fixed value lists | `text` + `CHECK (x IN (...))`, never a Postgres `ENUM` type. A `CHECK` is changed in one migration; an `ENUM` value can never be removed. |
| Index names | Postgres' own default style: `<table>_<columns>_idx`, `<table>_<columns>_key` for unique ones. |
| Constraint names | Left to Postgres (`<table>_<column>_check`, `_fkey`), so most migrations don't name them at all. |
| Foreign keys | No `ON DELETE CASCADE` anywhere. Nothing that other rows point to is ever deleted, so the default (refuse the delete) is the right one. |
| Hashes | `bytea` with `CHECK (octet_length(x) = 32)` (SHA-256). |

## Disable, delete, retention

No soft delete (`deleted_at`) anywhere. A soft-deleted row has to be filtered out by every query forever, and history needs the row to stay anyway. Instead each table has one clear lifecycle:

| Table | Lifecycle | Kept |
|---|---|---|
| `players` | Disabled (`disabled_at` + reason), never deleted: matches point to them | Forever |
| `player_secrets` | Revoked (`revoked_at`), never deleted | Forever (tiny, and useful when looking into abuse) |
| `games` | Never deleted once a match uses it (the foreign key refuses) | Forever |
| `tournaments` | Cancelled (`cancelled_at`), never deleted | Forever |
| `tournament_players` | Deleted when an admin unregisters a player (audited) | While registered |
| `rooms` | Never deleted: matches point to them | Forever (one small row per table opened) |
| `room_assignments` | Deleted when an admin takes a player out of a room (audited) | While the assignment holds |
| `matches`, `match_players`, `match_logs` | Append-only | Forever (Erdin's decision) |
| `admins` | Disabled (`disabled_at`); `root` can never be disabled | Forever |
| `admin_sessions` | Deleted on logout; expired ones are deleted at the next login | Until expiry |
| `admin_audit_events` | Append-only | Forever |

Storage estimate: the move log is the big one, about 25 KB per match before compression, so roughly 2.5 GB per 100,000 matches. Everything else is small.

## Changes, table by table

### `players`

| Change | Why |
|---|---|
| `display_name` must be trimmed and contain no control characters | Today a name like `"Rina\n"` passes Zod (it only trims and counts). Names show up in the backoffice and in rooms; a newline or a zero-width trick shouldn't be storable. Zod gets the same rule so the API answers 400 instead of hitting the constraint. |
| `disabled_at` and `disabled_reason` are set together, reason 1–200 characters | The backoffice always writes both; the database should refuse half a state. 200 = `REASON_MAX` in the backoffice. |

### `player_secrets`

| Change | Why |
|---|---|
| `secret_hash` must be 32 bytes | It is always `sha256(secret)`. Anything else is a bug (for example a raw secret stored by mistake). |

### `games`

No change. It was designed in `006` with checks already.

### `tournaments`, `tournament_players`, `rooms` and `room_assignments` (new)

Today the **browser** makes up the room code (`newRoomCode()` in `apps/web/src/lib/guest.ts`) and any code typed into the URL creates a room on the spot. Nothing outside the actor knows a room exists, so there is no way to prepare a room and send players into it.

New: the **platform** generates every code and keeps one row per room. An admin can create a **tournament**, register many players into it, and let the platform spread them over as many rooms as needed, based on how many players fit in one room (Erdin, 2026-11-11).

```sql
-- An admin-run tournament: one game, a start time, many players, one or more rooms.
CREATE TABLE tournaments (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug            text NOT NULL REFERENCES games(slug),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  players_per_room     smallint NOT NULL CHECK (players_per_room BETWEEN 1 AND 32),  -- most players in one room; within the game's min/max (checked on save)
  starts_at            timestamptz NOT NULL,
  registration_opens_at   timestamptz NOT NULL DEFAULT now(),
  registration_closes_at  timestamptz NOT NULL,  -- also when players get rooms (default: starts_at - 10 min)
  distributed_at       timestamptz,           -- when that actually ran
  distribute_error     text,                  -- why the last automatic run couldn't, shown in the backoffice
  cancelled_at         timestamptz,
  ended_at             timestamptz,           -- when its last room closed: ended_at - starts_at = how long it ran
  created_by_admin_id  uuid NOT NULL REFERENCES admins(id),
  created_at, updated_at,
  UNIQUE (id, game_slug),  -- lets rooms check they are the tournament's game
  CHECK (registration_opens_at < registration_closes_at AND registration_closes_at <= starts_at),
  CHECK (ended_at IS NULL OR ended_at >= starts_at)
);
CREATE INDEX tournaments_starts_at_idx ON tournaments (starts_at DESC);
CREATE INDEX tournaments_due_idx ON tournaments (registration_closes_at) WHERE distributed_at IS NULL AND cancelled_at IS NULL;  -- the distribute job

-- Players registered for a tournament, before and after they get a room.
CREATE TABLE tournament_players (
  tournament_id                uuid NOT NULL REFERENCES tournaments(id),
  player_id               uuid NOT NULL REFERENCES players(id),
  registered_by_admin_id  uuid REFERENCES admins(id),  -- null = the player signed up themselves
  created_at, updated_at,
  PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX tournament_players_player_id_idx ON tournament_players (player_id);

CREATE TABLE rooms (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug             text NOT NULL REFERENCES games(slug),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,8}$'),
  tournament_id              uuid,                          -- null = an open room anyone with the code can join
  created_by_player_id  uuid REFERENCES players(id),   -- a player pressed "New table"
  created_by_admin_id   uuid REFERENCES admins(id),    -- an admin made it in the backoffice (null for tournament rooms the job made)
  started_at            timestamptz,                   -- tournament rooms: when the match began
  closed_at             timestamptz,                   -- tournament rooms: when it was done
  close_reason          text CHECK (close_reason IN ('finished', 'not_enough_players')),
  created_at, updated_at,
  FOREIGN KEY (tournament_id, game_slug) REFERENCES tournaments(id, game_slug),  -- a tournament room plays the tournament's game
  UNIQUE (id, tournament_id),                                               -- for room_assignments below
  CHECK (num_nonnulls(created_by_player_id, created_by_admin_id) <= 1), -- neither = made before this change
  CHECK (tournament_id IS NULL OR created_by_player_id IS NULL),           -- players never make tournament rooms
  CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  CHECK (tournament_id IS NOT NULL OR (started_at IS NULL AND closed_at IS NULL))  -- open rooms don't track these
);
CREATE INDEX rooms_game_slug_id_idx ON rooms (game_slug, id DESC);
CREATE INDEX rooms_tournament_id_idx ON rooms (tournament_id) WHERE tournament_id IS NOT NULL;

-- Which room (and seat) each registered player got.
CREATE TABLE room_assignments (
  room_id               uuid NOT NULL,
  tournament_id              uuid NOT NULL,                 -- copied from the room so the rule below can be a constraint
  player_id             uuid NOT NULL REFERENCES players(id),
  seat                  smallint CHECK (seat BETWEEN 0 AND 31),  -- null = any free seat
  assigned_by_admin_id  uuid REFERENCES admins(id),     -- null = placed by the distribute job
  created_at, updated_at,
  PRIMARY KEY (room_id, player_id),
  FOREIGN KEY (room_id, tournament_id) REFERENCES rooms(id, tournament_id),                -- only tournament rooms take assignments
  FOREIGN KEY (tournament_id, player_id) REFERENCES tournament_players(tournament_id, player_id), -- only registered players
  UNIQUE (room_id, seat),                                                         -- one player per seat
  UNIQUE (tournament_id, player_id)                                                    -- one room per player per tournament
);
CREATE INDEX room_assignments_player_id_idx ON room_assignments (player_id);
```

How a tournament runs:

1. **Create** the tournament in the backoffice: game, name, start time, players per room (for example 6 for Bust 31), and the registration window: opens (default: now) and closes (default: 10 minutes before the start).
2. **Register players**, two ways, both only while registration is open (`registration_opens_at` to `registration_closes_at`): an admin pastes a list of player ids in the backoffice, or a player presses **Join tournament** on the game's home page (`registered_by_admin_id` is then null). A player can leave again until it closes. Registering twice does nothing.
3. **Distribute, automatically**: when registration closes (`registration_closes_at`) the platform's distribute job does it, with no admin needed (Erdin wanted it fully automatic). The backoffice also has a "Distribute now" button that runs the same code early. The platform shuffles the registered players who have no room yet, opens `ceil(n / players_per_room)` rooms, and splits them as evenly as possible, each on a seat. 20 players at 6 per room → 4 rooms of 5, not 6+6+6+2. If a room would end up below the game's minimum (3 players at 2 per room → 2 + 1), it refuses and says how many players to add or remove. Everything happens in one transaction with one audit event, and sets `distributed_at`. If the job can't distribute (too few players for the game's minimum, or nobody registered), it writes the reason to `distribute_error`, the tournament page shows it in red, and the job tries again on every tick until an admin fixes the registrations or cancels.
4. **Late changes**: once registration has closed, nobody can sign up; an admin can still add a player by hand into a room with a free seat. Nobody already seated is ever moved. Unregistering a seated player removes their seat first.
5. **Play**: players see their table on the game's home page and join before the start; every room starts on its own at `starts_at` (see "Inside the room" below).

| Room | Who makes it | Who can sit |
|---|---|---|
| Open (`tournament_id` null) | A player presses "New table" | Anyone with the code, like today |
| Tournament room | The distribute job (or an admin's "Distribute now" / "Add room"), always a row in `rooms` with its `tournament_id` | Only the assigned players, on their seat if one is set. Not shown in "Open tables". |

Rules the database holds, so neither app can get them wrong:

- A tournament room plays the tournament's game (composite foreign key on `(tournament_id, game_slug)`).
- Only tournament rooms take assignments, only **registered** players get a seat, one player per seat, and **a player is in at most one room of a tournament** (`UNIQUE (tournament_id, player_id)`).
- Players never make tournament rooms; only the distribute job or an admin does.

**When a tournament ends** (Erdin wanted to know how long each one ran). Every tournament room records `started_at` when its match begins and `closed_at` when it is done, and the tournament gets `ended_at` the moment its last room closes. How long it ran is `ended_at - starts_at`; how long each table took is `closed_at - started_at` per room.

| Event | What is written |
|---|---|
| The room starts its match at `starts_at` | The room tells the platform (`POST /v1/rooms/:code/start`, server key) → `rooms.started_at` |
| That match is reported (`POST /v1/matches`) | Same transaction: `rooms.closed_at`, `close_reason = 'finished'` |
| The room gives up (below the game's minimum after the 3-minute wait) | The room tells the platform (`POST /v1/rooms/:code/close`) → `close_reason = 'not_enough_players'` |
| Nobody ever opened the room (no assigned player connected, so the actor never woke) | The 30-second job closes it at `starts_at + 4 min` (the 3-minute wait plus a margin) with `not_enough_players` |
| The last room of a tournament closes | Same transaction: `tournaments.ended_at = now()` |

A started room is never closed by the job: its match always reaches the platform through the room's outbox, however long it takes. ponytail: a room whose actor dies for good mid-match would keep its tournament open; an admin can close it from the tournament page if that ever happens.

**Someone outside the tournament joins by code.** A tournament room's code works like any other in the URL, so it must be safe to share or guess. It is, in two places:

1. The game's server asks the platform about the room before it hands out a room token (`GET /v1/rooms/:code` with the player's secret). For a tournament room the platform answers 403 unless that player has a `room_assignments` row for it, so the browser never gets a token and can't even reach the room. The page says "This table is for players of Friday Cup".
2. The room actor checks again when someone takes a seat: only assigned players, on their own seat. So even a bug in step 1 can't put an outsider in the match.

Watching a tournament table as a spectator isn't part of this design; it would be a separate "watch" permission later.

Tournament lifecycle, same pattern as players: `cancelled_at` instead of a delete or a status column. A cancelled tournament's rooms refuse new joins. Tournaments, rooms and assignments of past tournaments stay, so results can always be traced back to the tournament (`matches.room_id` → `rooms.tournament_id`).

**The distribute job.** There is no cron service on the VPS, and none is needed: the platform process runs a small loop every 30 seconds.

```sql
-- Picks due tournaments without blocking or double-running, even with more than one platform instance.
SELECT id FROM tournaments
WHERE registration_closes_at <= now() AND distributed_at IS NULL AND cancelled_at IS NULL
ORDER BY registration_closes_at
FOR UPDATE SKIP LOCKED
LIMIT 10;
```

The same tick also closes tournament rooms nobody opened (see "When a tournament ends"). Each picked tournament is distributed inside that same transaction, so a crash halfway leaves nothing behind and the next tick simply tries again. The loop logs each run and each failure. ponytail: a 30-second loop in the platform process is enough for one VPS; if the platform ever runs on several machines it still works (the `SKIP LOCKED` makes that safe), and only a much larger number of jobs would call for a real queue.

How the code is generated: 5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O, 1/I), the same alphabet as today, now in the platform with `crypto.getRandomValues`. The insert uses `ON CONFLICT (code) DO NOTHING` and tries a new code if it collides (up to 5 times). A code is never reused, so an old link or match always means one room. ponytail: 32^5 is about 33 million codes; past ~1 million rooms collisions get frequent, and the fix is a 6th character.

How it flows (the parts outside the schema, for the build):

1. **New table:** browser → game server `POST /api/<game>/rooms` → platform `POST /v1/rooms {game}` (player secret) → returns the code. The browser no longer makes codes.
2. **Join by code:** before the game server issues a room token, it asks the platform `GET /v1/rooms/<code>` with the player's secret. Unknown code or wrong game → 404; a tournament room the player isn't assigned to, or of a cancelled tournament → 403. So a typed-in code can no longer create a room.
3. **Inside the room:** when the room actor starts, it reads its room from the platform with the server key (tournament, start time, assignments). In a tournament room only assigned players can take a seat, each on their fixed seat, and nobody presses Start: the room **starts by itself at `starts_at`** (Erdin, 2026-11-11), with `c.schedule` like the turn timer. **Late players** (Erdin, 2026-11-11): the room waits up to **3 minutes** after `starts_at` so everyone can arrive. It starts as soon as every assigned player is connected, or when the 3 minutes are up, with whoever is there, if that is at least the game's minimum (2 for both games today). Assigned players who still aren't there then lose their seat for that match. Below the minimum at 3 minutes, the room closes the table with "Not enough players showed up". The wait is one constant (`LATE_GRACE_MS`) in the shared room code. Tournament rooms don't report to the public room list.
4. **Players find tournaments:** platform `GET /v1/tournaments?game=<slug>` lists tournaments with open registration (name, start time, players registered); `POST` / `DELETE /v1/tournaments/:id/registration` signs the player up or out, refused outside the window or for a disabled player.
5. **Assigned players find their room:** platform `GET /v1/players/me/rooms` returns the tournament rooms the player is assigned to, with the tournament's name and start time, so the game's home page can show "Friday Cup, 20:00, your table: K7QXM, Join".
6. **Backoffice:** a Tournaments screen (list, new tournament, cancel); a tournament's page registers players (paste ids), runs Distribute, lists its rooms and who sits where, and moves or removes players by hand; rooms and matches link back to their tournament. Every write is an audit event.

### `matches`

| Change | Why |
|---|---|
| `room_code` becomes `room_id REFERENCES rooms(id)` | The room is now a row; a match links to it instead of repeating its code. The room report keeps sending `roomCode`, and the platform looks the room up, so `POST /v1/matches` doesn't change for the games. A code with no room → 422, like an unknown player. |
| `id` must be a version 7 UUID | Lists page by `id` because a v7 id sorts by time. A room sending a random v4 id would silently break the order. Checked as `substr(id::text, 15, 1) = '7'` because `uuid_extract_version()` doesn't exist on the Postgres 16 used for local tests. |
| `rules_version >= 1`, `ended_at >= started_at`, `body_hash` 32 bytes | Same rules Zod already applies; now the database holds them too. |
| Index `(game_slug, ended_at DESC)` replaced by `(game_slug, id DESC)` and `(ended_at)` | The backoffice list filters by game and sorts by `id`, so the old index couldn't serve its sort. The date filter gets its own small index. |
| Append-only | It is history. |

### `match_players`

| Change | Why |
|---|---|
| `seat` 0–31, `placement` 1–32, `bot_name` 1–20 characters, `score` within ±1,000,000 | Same limits as the API. `match-schema.md` already says `placement >= 1`, but no migration ever added it. |
| A player sits at most once per match: the history index becomes `UNIQUE (player_id, match_id DESC) WHERE player_id IS NOT NULL` | Only Zod checked this. Same index the history query already uses, so it costs nothing extra. |
| At most one winner: `UNIQUE (match_id) WHERE placement = 1` | "Exactly one first place" is a core rule of every game report. The database can guarantee "at most one" cheaply; "at least one" stays in Zod (it would need a deferred trigger). |
| Append-only | It is history. |

### `match_logs`

| Change | Why |
|---|---|
| `events` must be a JSON array, `event_count = jsonb_array_length(events)`, count 1–5,000, `log_version >= 1` | `event_count` exists so lists don't have to open the big `tournaments` value. If the two ever disagree, the count is wrong everywhere it is shown. |
| Append-only | It is the audit record of every move. |

### `admins`

| Change | Why |
|---|---|
| `root` can never be disabled: `CHECK (username <> 'root' OR disabled_at IS NULL)` | `platform-api.md` promises this, but nothing enforces it. Disabling `root` by mistake could lock the team out. |
| `password_hash` must start with `$argon2id$` | `Bun.password` always writes that format. It stops a plaintext or a weak hash from ever being stored by a script. |

### `admin_sessions`

| Change | Why |
|---|---|
| `token_hash` 32 bytes, `expires_at > created_at` | Same reasoning as the secrets. |

### `admin_audit` becomes `admin_audit_events`

| Change | Why |
|---|---|
| Renamed to `admin_audit_events` | The only table name that isn't a plural noun. One row is one event. |
| `target_id` becomes `player_id REFERENCES players(id)`, plus new `tournament_id` and `room_id` columns with foreign keys | Every action so far targets a player, and the audit screen already joins it to `players`. Tournament and room actions target those (an assignment also names the player). One column per kind of target, each with a foreign key, instead of an untyped `target_id`. |
| `action IN ('login', 'login_failed', 'logout', 'player.disable', 'player.enable', 'tournament.create', 'tournament.update', 'tournament.cancel', 'tournament.register', 'tournament.unregister', 'tournament.distribute', 'room.assign', 'room.unassign')` | The list of actions is the audit log's vocabulary. A typo in code would otherwise write an action no filter will ever find. A new action = add it to the check in the same migration as the code. |
| `detail` must be a JSON object | It always is; reading code assumes it. |
| Index `admin_audit_created` dropped | The audit screen sorts and pages by `id`, which the primary key already serves. |
| Append-only | An audit log anyone can edit isn't an audit log. |

### Append-only, in practice

One trigger function, attached to `matches`, `match_players`, `match_logs` and `admin_audit_events`:

```sql
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER matches_append_only BEFORE UPDATE OR DELETE ON matches
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
```

No code updates or deletes these rows today, so nothing breaks. If a future migration ever has to fix data in them, it says so openly with `ALTER TABLE ... DISABLE TRIGGER ...` and enables it again in the same migration.

These tables keep `updated_at` and its trigger, as on every table; on them it simply always equals `created_at`.

## Indexes after the change

Every index, and the query it is for:

| Index | Query |
|---|---|
| `players` PK | Player detail, history joins |
| `player_secrets` PK `(secret_hash)` | Every authenticated platform call |
| `player_secrets_player_id_idx` | Disable a player (revoke all their secrets) |
| `matches` PK | Backoffice match list without filters (newest first, pages by `id`), match detail |
| `matches_game_slug_id_idx (game_slug, id DESC)` | Backoffice match list filtered by game |
| `matches_ended_at_idx (ended_at)` | Backoffice match list filtered by date |
| `match_players` PK `(match_id, seat)` | Seats of a match, player count, winner |
| `match_players_player_id_match_id_key` (unique, partial) | A player's history (platform and backoffice), "filter by player" |
| `match_players_winner_key` (unique, partial) | Constraint only |
| `match_logs` PK | Move log of a match |
| `admins_username_key` | Admin login |
| `admin_sessions` PK `(token_hash)` | Every backoffice request |
| `admin_sessions_admin_id_idx` | Foreign key lookups |
| `rooms_code_key` (unique) | Join by code, match reports |
| `rooms_game_slug_id_idx (game_slug, id DESC)` | Backoffice rooms screen filtered by game |
| `tournaments_starts_at_idx` | Backoffice tournaments list (newest first) |
| `tournaments_due_idx` (partial) | The distribute job: only tournaments still waiting, so it stays tiny |
| `tournament_players` PK `(tournament_id, player_id)` | A tournament's registered players |
| `tournament_players_player_id_idx` | Tournaments a player is registered for |
| `rooms_tournament_id_idx` (partial) | A tournament's rooms |
| `room_assignments` PK `(room_id, player_id)` | A room's assigned players (actor start, backoffice) |
| `room_assignments_tournament_id_player_id_key` | Constraint; also "is this player already in this tournament" |
| `room_assignments_player_id_idx` | "My rooms" for a player |
| `matches_room_id_idx` | A room's matches (backoffice room detail) |
| `admin_audit_events` PK | Audit screen (newest first, pages by `id`) |
| `admin_audit_events_login_failed_idx` (partial) | Login lockout count |

## Full schema after the change

What a fresh database looks like after `001`–`008` (Cloudburst's `007` only inserts its `games` row). Triggers for `updated_at` and append-only are left out of the listing.

```sql
CREATE TABLE players (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 20
                                        AND display_name = btrim(display_name)
                                        AND display_name !~ '[[:cntrl:]]'),
  disabled_at      timestamptz,
  disabled_reason  text CHECK (char_length(disabled_reason) BETWEEN 1 AND 200),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL))
);

CREATE TABLE player_secrets (
  secret_hash  bytea PRIMARY KEY CHECK (octet_length(secret_hash) = 32),  -- sha256(secret)
  player_id    uuid NOT NULL REFERENCES players(id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_secrets_player_id_idx ON player_secrets (player_id);

CREATE TABLE games (  -- unchanged
  slug         text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  min_players  smallint NOT NULL CHECK (min_players >= 1),
  max_players  smallint NOT NULL CHECK (max_players BETWEEN min_players AND 32),
  score_label  text NOT NULL CHECK (char_length(score_label) BETWEEN 1 AND 24),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  username       text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash  text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (username <> 'root' OR disabled_at IS NULL)
);

CREATE TABLE admin_sessions (
  token_hash  bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),  -- sha256(token)
  admin_id    uuid NOT NULL REFERENCES admins(id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX admin_sessions_admin_id_idx ON admin_sessions (admin_id);

CREATE TABLE tournaments (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug            text NOT NULL REFERENCES games(slug),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  players_per_room     smallint NOT NULL CHECK (players_per_room BETWEEN 1 AND 32),
  starts_at            timestamptz NOT NULL,
  registration_opens_at   timestamptz NOT NULL DEFAULT now(),
  registration_closes_at  timestamptz NOT NULL,  -- also when players get rooms (default: starts_at - 10 min)
  distributed_at       timestamptz,           -- when that actually ran
  distribute_error     text,                  -- why the last automatic run couldn't, shown in the backoffice
  cancelled_at         timestamptz,
  ended_at             timestamptz,           -- when its last room closed: ended_at - starts_at = how long it ran
  created_by_admin_id  uuid NOT NULL REFERENCES admins(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, game_slug),
  CHECK (registration_opens_at < registration_closes_at AND registration_closes_at <= starts_at),
  CHECK (ended_at IS NULL OR ended_at >= starts_at)
);
CREATE INDEX tournaments_starts_at_idx ON tournaments (starts_at DESC);
CREATE INDEX tournaments_due_idx ON tournaments (registration_closes_at) WHERE distributed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE tournament_players (
  tournament_id                uuid NOT NULL REFERENCES tournaments(id),
  player_id               uuid NOT NULL REFERENCES players(id),
  registered_by_admin_id  uuid REFERENCES admins(id),  -- null = the player signed up themselves
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX tournament_players_player_id_idx ON tournament_players (player_id);

CREATE TABLE rooms (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  game_slug             text NOT NULL REFERENCES games(slug),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,8}$'),
  tournament_id              uuid,
  created_by_player_id  uuid REFERENCES players(id),
  created_by_admin_id   uuid REFERENCES admins(id),
  started_at            timestamptz,
  closed_at             timestamptz,
  close_reason          text CHECK (close_reason IN ('finished', 'not_enough_players')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tournament_id, game_slug) REFERENCES tournaments(id, game_slug),
  UNIQUE (id, tournament_id),
  CHECK (num_nonnulls(created_by_player_id, created_by_admin_id) <= 1),
  CHECK (tournament_id IS NULL OR created_by_player_id IS NULL),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  CHECK (tournament_id IS NOT NULL OR (started_at IS NULL AND closed_at IS NULL))
);
CREATE INDEX rooms_game_slug_id_idx ON rooms (game_slug, id DESC);
CREATE INDEX rooms_tournament_id_idx ON rooms (tournament_id) WHERE tournament_id IS NOT NULL;

CREATE TABLE room_assignments (
  room_id               uuid NOT NULL,
  tournament_id              uuid NOT NULL,
  player_id             uuid NOT NULL REFERENCES players(id),
  seat                  smallint CHECK (seat BETWEEN 0 AND 31),
  assigned_by_admin_id  uuid REFERENCES admins(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id),
  FOREIGN KEY (room_id, tournament_id) REFERENCES rooms(id, tournament_id),
  FOREIGN KEY (tournament_id, player_id) REFERENCES tournament_players(tournament_id, player_id),
  UNIQUE (room_id, seat),
  UNIQUE (tournament_id, player_id)
);
CREATE INDEX room_assignments_player_id_idx ON room_assignments (player_id);

CREATE TABLE matches (  -- append-only
  id             uuid PRIMARY KEY CHECK (substr(id::text, 15, 1) = '7'),  -- UUIDv7 from the room
  game_slug      text NOT NULL REFERENCES games(slug),
  room_id        uuid NOT NULL REFERENCES rooms(id),
  rules_version  int NOT NULL CHECK (rules_version >= 1),
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL,
  body_hash      bytea NOT NULL CHECK (octet_length(body_hash) = 32),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);
CREATE INDEX matches_game_slug_id_idx ON matches (game_slug, id DESC);
CREATE INDEX matches_ended_at_idx ON matches (ended_at);
CREATE INDEX matches_room_id_idx ON matches (room_id);

CREATE TABLE match_players (  -- append-only
  match_id    uuid NOT NULL REFERENCES matches(id),
  seat        smallint NOT NULL CHECK (seat BETWEEN 0 AND 31),
  player_id   uuid REFERENCES players(id),
  bot_name    text CHECK (char_length(bot_name) BETWEEN 1 AND 20),
  placement   smallint NOT NULL CHECK (placement BETWEEN 1 AND 32),
  score       int NOT NULL CHECK (score BETWEEN -1000000 AND 1000000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seat),
  CHECK ((player_id IS NULL) = (bot_name IS NOT NULL))
);
CREATE UNIQUE INDEX match_players_player_id_match_id_key ON match_players (player_id, match_id DESC) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX match_players_winner_key ON match_players (match_id) WHERE placement = 1;

CREATE TABLE match_logs (  -- append-only
  match_id     uuid PRIMARY KEY REFERENCES matches(id),
  log_version  int NOT NULL CHECK (log_version >= 1),
  event_count  int NOT NULL CHECK (event_count BETWEEN 1 AND 5000),
  events       jsonb NOT NULL CHECK (jsonb_typeof(events) = 'array'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (event_count = jsonb_array_length(events))
);

CREATE TABLE admin_audit_events (  -- append-only
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  admin_id    uuid REFERENCES admins(id),   -- null for a failed login
  action      text NOT NULL CHECK (action IN ('login', 'login_failed', 'logout', 'player.disable', 'player.enable',
                                              'tournament.create', 'tournament.update', 'tournament.cancel',
                                              'tournament.register', 'tournament.unregister', 'tournament.distribute',
                                              'room.assign', 'room.unassign')),
  player_id   uuid REFERENCES players(id),  -- the player the action was on, if any
  tournament_id    uuid REFERENCES tournaments(id),   -- the tournament the action was on, if any
  room_id     uuid REFERENCES rooms(id),    -- the room the action was on, if any
  detail      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_events_login_failed_idx ON admin_audit_events ((detail->>'username'), created_at DESC) WHERE action = 'login_failed';
```

## Migration path

One new migration, `008_production_schema.sql`, made only of `ALTER`s on the existing tables. No table is rebuilt and no data is copied, so a database that already has players and matches keeps all of them. The runner already applies each file in one transaction, so if any existing row breaks a new rule the whole migration rolls back and the platform refuses to start, with the offending constraint named in the log. Nothing is half applied.

A draft of `008` (including rooms) was dry-run on Postgres 16 against `001`–`007` with sample data: it applies cleanly, moves existing matches onto rooms, and the new rules reject an `UPDATE` on `matches`, a `DELETE` on the audit log, disabling `root`, a name with a newline, an unknown audit action, a v4 match id, a second winner, a tournament room made by a player, a room whose game differs from its tournament, two players on one seat, a seat for an unregistered player, and one player in two rooms of the same tournament.

Before deploying, run these on the live database. Each must return 0 (or the listed rows must be fixed first):

```sql
SELECT count(*) FROM players WHERE display_name <> btrim(display_name) OR display_name ~ '[[:cntrl:]]';
SELECT count(*) FROM players WHERE (disabled_at IS NULL) <> (disabled_reason IS NULL);
SELECT count(*) FROM matches WHERE substr(id::text, 15, 1) <> '7' OR octet_length(body_hash) <> 32;
SELECT count(*) FROM (SELECT match_id FROM match_players WHERE placement = 1 GROUP BY 1 HAVING count(*) > 1) x;
SELECT count(*) FROM (SELECT match_id, player_id FROM match_players WHERE player_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x;
SELECT count(*) FROM match_logs WHERE event_count <> jsonb_array_length(events);
SELECT count(*) FROM (SELECT room_code FROM matches GROUP BY 1 HAVING count(DISTINCT game_slug) > 1) x;
SELECT count(*) FROM admin_audit WHERE target_id IS NOT NULL AND target_id NOT IN (SELECT id FROM players);
```

Existing matches keep their room: `008` creates one open room per distinct `room_code` already in `matches` (with no creator, since we don't know it), fills `matches.room_id` from it, then drops `room_code`. This runs before the append-only trigger is added, in the same migration. Codes are unique across games, so the preflight query above must also show no code used by two games (very unlikely with random codes; if it happens, that one match's code is fixed by hand first).

Order relative to Cloudburst: its `007_cloudburst.sql` only inserts a `games` row, which already satisfies every rule here, so the two can merge in either order.

Roll back: the end of `008` lists the reverse statements, as `006` does (drop the new checks, indexes and triggers, rename `admin_audit_events` and `player_id` back, recreate the two old indexes). No data is lost either way.

## Code that changes with it

The hardening part is small. Rooms are a real feature and touch every app, so they are built as their own step after it:

Hardening:

- **Platform** `players.ts`: the name rule in Zod also refuses control characters (same rule as the database).
- **Backoffice** `auth.ts`, `audit-log.ts`, `players.ts`: `admin_audit` becomes `admin_audit_events`, `target_id`/`targetId` becomes `player_id`/`playerId`.

Rooms:

- **Platform**: tournament list and sign-up (`GET /v1/tournaments`, `POST`/`DELETE /v1/tournaments/:id/registration`); the distribute job (a 30-second loop started in `index.ts`, the distribution itself in one plain function shared with the backoffice's "Distribute now"); `POST /v1/rooms`, `GET /v1/rooms/:code` (player secret, or server key for the actor), `GET /v1/players/me/rooms`; `POST /v1/rooms/:code/start` and `/close` (server key, tournament rooms); `POST /v1/matches` maps `roomCode` to `room_id` and closes a tournament room (and its tournament, if it was the last). Creating and changing tournaments has no platform API: only the backoffice does that.
- **Game web**: "New table" asks the server for a code; the room token route checks the room with the platform first; home page shows assigned rooms. `newRoomCode()` is deleted.
- **Room actors** (`games/shared/room.ts`, one place for both games): read the room on start, enforce assignments and the start time in tournament rooms, keep tournament rooms off the public list.
- **Backoffice**: Tournaments screen and tournament page (register players, Distribute, rooms and seats, move/remove, cancel), tournament and room shown on match detail. Distribute is a plain function with its own test: balanced sizes, nobody seated twice, refuses below the game's minimum.
- **Tests**: fixtures that insert a 1-byte `body_hash` use a 32-byte one; new checks below.
- **Docs**: this file becomes the schema reference. The "Data store" section of `platform-api.md` is replaced by a link here (it is out of date), and `match-schema.md` keeps only the rules for games.

## Left out on purpose

Each of these has a point at which it becomes worth doing:

| Not now | Add it when |
|---|---|
| Tournament results and brackets (standings across rooms, next round) | A tournament has more than one round. Today its results are the matches of its rooms. |
| Seeding or skill-based distribution | Players have a rating. Distribute is random today. |
| Player-made private rooms | Players want a table that isn't in "Open tables". One more column on `rooms`. |
| Trigram index for player name search (`pg_trgm`) | `players` passes ~100k rows and the backoffice search gets slow. Today the `ILIKE` scan is a few milliseconds. |
| Cleaning up guests who never played | Abandoned guests become a noticeable share of the table. It would delete players with no matches and no visit for a year; the only deletion in the schema, so it gets its own design. |
| Name change history | Moderation needs "who was called X last week". |
| Game status (`active` / `maintenance`) | Phase 2, when the backoffice toggles it. One column on `games`. |
| Admin roles, 2FA, session IP/device | Phase 2, as planned in `platform-api.md`. |
| Player stats or leaderboard tables | Phase 2 stats run as queries on `match_players` first; a summary table only if they get slow. |
| One row per move event | Cross-match questions like "all timeouts by player X" (see `match-log.md`). |
| Migration checksums and a lock in the runner | More than one platform instance, or a migration ever gets edited after it shipped. |
| Squashing `001`–`008` into one baseline file | Never needed for running; only for reading, and this file covers that. |

## Checks to leave behind

One schema test file in the platform (`schema.test.ts`), each check a plain insert or update that must fail:

- A match `UPDATE` or `DELETE` is refused; same for `match_players`, `match_logs`, `admin_audit_events`.
- Two first places in one match, or one player in two seats, are refused.
- A non-v7 match id, a short `body_hash`, or `event_count` that doesn't match the log is refused.
- `root` cannot be disabled; another admin can.
- A player name with a newline is refused by both the API (400) and the database.
- An unknown audit action is refused.
- A tournament room made by a player, or with a different game than its tournament, is refused; two players on one seat, a seat for an unregistered player, or one player in two rooms of the same tournament, are refused.
- Distribute: 20 players at 6 per room → 4 rooms of 5; running it again moves nobody; 3 players at 2 per room is refused and leaves `distribute_error`.
- Ending: the last room's match report sets `tournaments.ended_at`; a room nobody opened is closed by the job after `starts_at + 4 min`; a started room is never closed by the job.
- Room: a tournament room starts early when all assigned players are in; otherwise at `starts_at + 3 min` with those present, dropping the rest; below the game's minimum then, it closes as `not_enough_players`.
- Sign-up: joining before `registration_opens_at` or after `registration_closes_at` is refused; joining twice is a no-op.
- Distribute job: a tournament past `registration_closes_at` is distributed once, even when two job runs overlap; a cancelled or not-yet-due one is left alone.
- Platform: a new room gets a unique 5-character code; joining an unknown code is 404; an unassigned player joining a tournament room, or anyone joining a cancelled tournament's room, is 403; a match report with an unknown room code is 422.

The existing platform and backoffice tests must stay green after the rename.
