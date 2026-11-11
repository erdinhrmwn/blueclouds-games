# Platform API — design proposal

Status: **proposal, not built**. Nothing in this file is implemented yet.

## Why

Today a player is a random token plus a name the browser types in. Every room actor trusts both. That means:

- Anyone can claim any name, and the room stores raw player secrets in its SQLite.
- Nothing remembers a player across rooms, so there are no results, stats or history.
- The room list's `report` / `remove` actions accept calls from any client.
- Nobody on the team can look up a player or a match without reading actor databases.

The **platform** is a separate service that owns **who a player is** and **what happened in each match**. It serves the platform API only: no UI and no admin API. The team's **backoffice** is its own app next to it. Game rules stay inside the actors.

## Decisions so far

| Question | Answer |
|---|---|
| Hosting | Everything self-hosted on a VPS: game frontend, Rivet engine + actors, platform, backoffice |
| Hostnames | Game `nblueclouds.online`, platform `api.nblueclouds.online`, backoffice `backoffice.nblueclouds.online` |
| First admin | Username `root` |
| Responsibility | Platform = player + match API only. Backoffice = separate app, no admin API on the platform |
| Bot matches | Recorded in history like any other match |
| Ids | UUIDv7 everywhere |
| Responses | One envelope for every response (see below) |

## Scope

| Phase | What | Why now / why later |
|---|---|---|
| **MVP** | Guest players, play tokens checked in actors, match result reporting (idempotent), room list locked to actors, backoffice: admin login, players, match history, disable a player, audit log | Fixes the trust gaps above, starts recording history, and gives the team eyes on it. |
| Phase 2 | Player stats, game catalog with `active` / `maintenance` status toggled from the backoffice, admin 2FA (TOTP), admin roles (viewer / admin) | Stats are queries over MVP tables. Catalog status lives in the platform DB (no Vercel Edge Config now that nothing runs on Vercel). |
| Phase 3 | Real accounts (email magic link or Google) linked to the guest id, leaderboards | Needs a login UI and email/OAuth setup. Guests upgrade in place, so nothing is lost by waiting. |
| Separate design | Wallet / balances | Money needs a ledger, audit trail and legal review. Not designed here on purpose. |

Out of scope: matchmaking, chat, friends, anti-cheat beyond "the server owns the game state" (it already does).

## Architecture

One VPS, one Docker Compose project. Caddy is the only thing listening on the internet.

```
                         VPS (Docker Compose)
  Internet ──▶ Caddy (TLS, :443)
                ├─ <domain>                 → web         (game frontend, SvelteKit adapter-node)
                ├─ api.<domain>/v1/*        → platform    (Bun, :3000)
                ├─ backoffice.<domain>      → backoffice  (SvelteKit adapter-node)
                └─ engine.<domain>          → rivet-engine (rooms: HTTP + WebSocket)
                                                 ▲
                              actors (apps/server) ── runner connection
                                │
                                └──▶ http://platform:3000  (private network)
               platform ──▶ postgres (private network)
               backoffice ──▶ postgres (own restricted role)
```

| Container | What | Reachable from |
|---|---|---|
| `caddy` | TLS (automatic HTTPS) + routing | Internet (80/443) |
| `web` | Game frontend (today's `apps/web`, switched from `adapter-vercel` to `adapter-node`) | Caddy |
| `rivet-engine` | Self-hosted Rivet Engine (single node) | Caddy, actors |
| `actors` | `apps/server`: room + directory actors, connected to the engine as a runner | Engine only |
| `platform` | `apps/platform`: `/v1` public + server API | Caddy, actors |
| `backoffice` | `apps/backoffice`: admin UI + its own server code, reads Postgres directly | Caddy |
| `postgres` | Postgres 18, platform data | platform, backoffice (separate roles) |
| `backup` | Nightly `pg_dump` + engine data snapshot to off-VPS storage | — |

- **platform** serves only the public and server API. It has no admin routes at all, so there is no admin surface on `api.`.
- **backoffice** uses SvelteKit server code (`+page.server.ts` loads and form actions) that queries Postgres directly with its own database role. That role can read player and match tables and only update the few columns needed to disable a player (see "Database roles").
- **Migrations have one owner:** the platform. The backoffice never changes the schema; it reads the same tables.
- **Actors → platform** go over the private network (`http://platform:3000`), so match reports never leave the VPS. The server key is still checked.
- Actors talk to the platform through one module, `apps/server/src/platform.ts` (`verifyPlayToken`, `reportMatch`), so game code never knows the platform's URL or format.

**Hostnames** (`<domain>` = `nblueclouds.online`):

| Host | Serves |
|---|---|
| `nblueclouds.online` | Game frontend |
| `api.nblueclouds.online` | Platform public + server API (`/v1`) |
| `backoffice.nblueclouds.online` | Backoffice |
| `engine.nblueclouds.online` | Rivet engine: room actions over HTTP and live updates over WebSocket |

**To verify against the Rivet docs before building:** the self-hosted engine image and its storage options, how `apps/server` connects to it as a runner, and what the engine's data volume needs for backups. The design does not depend on the answers.

### Tech stack

| Part | Choice | Notes |
|---|---|---|
| Platform runtime | Bun 1.3 | |
| HTTP framework | Hono 4 (`hono/bun`) | Built-in middleware covers CORS, body limit, request id and secure headers; `app.onError` / `app.notFound` force the envelope; `app.request()` makes route tests easy. Zero transitive deps. |
| Language | TypeScript | Same as the rest of the repo |
| Validation | Zod 4 | Already used by the actor server |
| Database | Postgres 18 | Built-in `uuidv7()` |
| DB driver | `Bun.sql` (built into Bun) | Tagged templates, parameterised by default; no ORM, no extra package |
| Migrations | Plain `.sql` files + a small runner (`bun run db:migrate`) | Applied files recorded in `schema_migrations` |
| Player tokens | `jose` (EdDSA / Ed25519 JWT) | Signed by the platform, verified in actors |
| Admin passwords | `Bun.password` (argon2id) | Built into Bun |
| Ids | UUIDv7: `uuidv7()` in SQL, `Bun.randomUUIDv7()` in code | Time-ordered, good index locality |
| Backoffice | SvelteKit 3 + `adapter-node`, Tailwind | Same framework the team already uses |
| Deploy | Docker Compose on one VPS (containers above) | Caddy gives automatic HTTPS |
| Tests | `bun test` | Same runner as the game rules |
| Key-value / cache (when needed) | DragonflyDB instead of Redis, via Bun's built-in Redis client | Not in the MVP: nothing needs it yet. It is added as a `dragonfly` container the first time something needs shared state, e.g. rate limits across several platform instances or a cache. |

New dependencies: `hono` (platform), `jose` (platform + actor server), `zod` (platform + backoffice), `@sveltejs/adapter-node` (backoffice and web, replacing `adapter-vercel`). The backoffice runs on Bun too, so it uses `Bun.sql` and `Bun.password` like the platform.

## Response envelope

Every response, success or error, has the same shape. Clients check `ok` first.

```ts
type ApiResponse<T> =
  | { ok: true;  data: T;    error: null }
  | { ok: false; data: null; error: { code: ErrorCode; message: string; fields?: Record<string, string> } };
```

```json
{ "ok": true,  "data": { "player": { "id": "…", "name": "Rina" } }, "error": null }
{ "ok": false, "data": null, "error": { "code": "bad_input", "message": "Name must be 1–20 characters.", "fields": { "name": "Must be 1–20 characters." } } }
```

Rules:

- `data` is always an object (never a bare array or string), so fields can be added later without breaking clients. Lists go in a named key with a cursor: `{ "players": [...], "nextCursor": "…" | null }`.
- `error.code` is a fixed, machine-readable string; `error.message` is safe to show; `error.fields` only appears for validation errors. Stack traces and internal details go to logs only.
- The HTTP status still matches the outcome (`ok: false` never comes with a `2xx`).
- Every response carries an `X-Request-Id` header, also written to the logs.
- One helper (`ok(data, status)` / `fail(code, status, message, fields?)` in `apps/platform/src/http.ts`) builds every response, and Hono's `app.onError` / `app.notFound` turn any thrown error or unknown route into the envelope (`internal` / `not_found`), so the shape cannot drift. Zod is called through one small `parse(schema, body)` helper that throws `bad_input` with `fields`, so no extra validator package is needed.

| `error.code` | Status | When |
|---|---|---|
| `bad_input` | 400 | Body or query fails validation |
| `unauthenticated` | 401 | Missing or invalid credential |
| `forbidden` | 403 | Authenticated but not allowed (e.g. disabled player) |
| `not_found` | 404 | Unknown resource |
| `conflict` | 409 | Same `matchId`, different body |
| `unknown_player` | 422 | Match references a player that does not exist |
| `rate_limited` | 429 | Too many requests |
| `internal` | 500 | Anything unexpected (generic message) |

The examples below show only `data`; the envelope around it is implied.

## Player auth flow

The platform lives on its own host, separate from the game frontend, so the game uses **bearer credentials**, not cookies. This works for any future frontend (another web game, a mobile app) and needs no cross-site cookie setup.

| Credential | Stored where | Lifetime | Used for |
|---|---|---|---|
| **Player secret** (32 random bytes, base64url) | Browser `localStorage` (as `guest-token` is today); platform stores only its SHA-256 | Until revoked | `Authorization: Bearer` to the player API |
| **Play token** (EdDSA JWT) | Browser memory only | 15 minutes | Connecting to a room actor |

```
Browser                          Platform (VPS)                      Room actor (Rivet)
  | POST /v1/players/guest {name}    |                                      |
  |--------------------------------->| create player + secret               |
  |<-- {player, playerSecret} -------|                                      |
  | POST /v1/play-tokens (Bearer)    |                                      |
  |--------------------------------->| check secret, player not disabled,   |
  |<-- {token, expiresAt} -----------| sign {sub, name, aud, exp}           |
  | connect(params: {playToken})                                            |
  |------------------------------------------------------------------------>| onBeforeConnect: verify with
  |                                                                         | PUBLIC key, read playerId + name
```

- Actors verify play tokens **locally** with the public key: no network call per connection, and a platform outage does not break running games.
- Only the platform holds the private key. A leaked actor env cannot mint tokens.
- A room maps `conn.id → playerId` in `c.vars`; actions use that map. The name comes from the token, not the client.
- Rooms stop storing secrets: `tokens: Record<secret, playerId>` becomes plain player ids.
- Disabling a player revokes their secrets, so they cannot get a new play token. A connection that is already open stays until it closes (at most one game); the 15-minute token limits reconnects.
- CORS: the platform only answers browser requests from origins in `ALLOWED_ORIGINS`.

Server-to-server calls (actor → platform) use `Authorization: Bearer <PLATFORM_SERVER_KEY>`, compared in constant time.

## Public API (MVP)

### `POST /v1/players/guest`

Request: `{ "name": "Rina" }`, trimmed, 1–20 chars.

`201`, `data: { "player": { "id": "uuidv7", "name": "Rina", "createdAt": "…" }, "playerSecret": "…" }`. The secret is shown only in this response.

Errors: `400 bad_input`, `429 rate_limited` (5/min per IP).

### `GET /v1/players/me`

Bearer player secret. `200`, `data: { "player": {…} }`; `401 unauthenticated`; `403 forbidden` if disabled.

### `PATCH /v1/players/me`

Bearer player secret. Request `{ "name": "Rina K" }`. `200`, `data: { "player": {…} }`. The game's name modal calls this; rooms pick up the new name at the next connect.

### `POST /v1/play-tokens`

Bearer player secret, no body. `200`, `data: { "token": "eyJ…", "expiresAt": "…" }`. Claims: `sub` (player id), `name`, `aud: "blueclouds-rooms"`, `iat`, `exp`.

### `GET /v1/players/me/matches?cursor=…`

Bearer player secret. The player's own history, newest first, 20 per page: `data: { "matches": [...], "nextCursor": "…" | null }`. Cheap to add because the table already exists, and it lets the game show "your last games".

## Server API (MVP)

### `POST /v1/matches`

Called by a room actor when a game finishes. Bearer `PLATFORM_SERVER_KEY`.

```json
{
  "matchId": "UUIDv7 generated by the room at startGame",
  "game": "bust-31",
  "roomCode": "K7PQX",
  "rulesVersion": 1,
  "startedAt": "2026-11-11T08:00:00Z",
  "endedAt": "2026-11-11T08:06:12Z",
  "players": [
    { "seat": 0, "playerId": "uuidv7", "bot": false, "placement": 1, "livesLeft": 2 },
    { "seat": 3, "playerId": null, "bot": true, "botName": "Bot Rain", "placement": 2, "livesLeft": 0 }
  ]
}
```

**Idempotent by `matchId`:**

| Case | Response |
|---|---|
| New `matchId` | `201`, `data: { "match": { "id": …, "created": true } }` |
| Same `matchId`, same body (retry) | `200`, `data: { "match": { "id": …, "created": false } }` |
| Same `matchId`, different body | `409 conflict` (logged; a bug, not a retry) |

"Same body" = SHA-256 of the canonical JSON, stored on the row. `INSERT … ON CONFLICT (id) DO NOTHING`, then compare hashes, in one transaction with the `match_players` rows.

Validation: `game` must be a known slug, 2–6 players, seats unique, exactly one `placement: 1`, every non-bot `playerId` must exist (`422 unknown_player`). Matches against bots only are recorded too.

**Actor side (outbox):** on `finished`, the room saves `{matchId, body}` to a `pending_reports` row in its own SQLite, then calls the API. On failure it retries with `c.schedule.after` (10s, 1m, 5m, 30m, then 6h until it succeeds, logging each failure). Because the endpoint is idempotent, a retry after a timeout that actually succeeded is harmless. A finished game never waits on this call.

## Backoffice (MVP)

`backoffice.nblueclouds.online` is a SvelteKit app (`adapter-node`, run with Bun). It has **no API of its own and the platform has none for it**: pages load data in `+page.server.ts` and change it through SvelteKit form actions, straight against Postgres.

Screens:

| Screen | What |
|---|---|
| Login | Username + password. 5 failed tries per username per 15 min → locked for 15 min. |
| Players | Search by name or id; detail with status and recent matches; disable (with a reason) / enable |
| Matches | List with filters (game, player, date range); detail with every seat |
| Audit log | Every admin action, newest first |

- Admin session: a random token in an `httpOnly`, `Secure`, `SameSite=Strict` cookie on the backoffice host (no `Domain` attribute, so it never reaches the game or the API). Only its SHA-256 is stored, in `admin_sessions`. 8-hour lifetime.
- Form actions are protected by SvelteKit's built-in CSRF origin check.
- **Disable a player** = in one transaction: set `players.disabled_at` + reason, set `revoked_at` on all their `player_secrets`, write an audit row. The platform then refuses that player's secret (`403`) on the next play-token request. **Enable** clears `disabled_at`; old secrets stay revoked, so the player starts a new guest session.
- Admins are created from the command line, never from a page: `docker compose exec backoffice bun run admin:create root` asks for the password on the terminal (never as an argument, so it stays out of shell history). The first admin is `root`.
- `root` cannot be disabled from the backoffice, so the team can never lock itself out.
- Every admin write (login, failed login, logout, disable, enable) writes one `admin_audit` row: who, what, target, reason, time, IP.
- One role in MVP (`admin`). Viewer/admin roles and TOTP 2FA come in Phase 2.

### Database roles

Two Postgres roles, so a bug in one app cannot do what only the other should:

| Role | Used by | Grants |
|---|---|---|
| `platform` | platform | Owns the schema and runs migrations. Full access to player and match tables. No access to `admin*` tables. |
| `backoffice` | backoffice | `SELECT` on `players`, `player_secrets` (no `secret_hash` column), `matches`, `match_players`. `UPDATE (disabled_at, disabled_reason)` on `players` and `UPDATE (revoked_at)` on `player_secrets`. Full access to `admins`, `admin_sessions`, `admin_audit`. |

The grants live in a platform migration, so they are versioned with the schema.

Trade-off of skipping an admin API: the backoffice depends on the table layout, so a schema change has to check both apps. With one repo, one migration owner and only a handful of backoffice queries, that is cheaper than maintaining a second API. If another tool ever needs admin actions, that is the moment to add an admin API.

## Locking the room list

`bust31Rooms.report` / `remove` require connection params `{ internalKey }` equal to `INTERNAL_ACTOR_KEY`, known only to the actor server. `list` stays public. (Needs a quick check that rivetkit 3 passes params on actor-to-actor handle calls; if not, the key moves into the action arguments.)

## Data store

```sql
CREATE TABLE players (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 20),
  disabled_at   timestamptz,
  disabled_reason text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_secrets (
  secret_hash   bytea PRIMARY KEY,            -- sha256(secret); 32 random bytes, so no slow hash needed
  player_id     uuid NOT NULL REFERENCES players(id),
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id            uuid PRIMARY KEY,             -- UUIDv7 chosen by the room: the idempotency key
  game_slug     text NOT NULL,
  room_code     text NOT NULL,
  rules_version int  NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  body_hash     bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_game_ended ON matches (game_slug, ended_at DESC);

CREATE TABLE match_players (
  match_id      uuid NOT NULL REFERENCES matches(id),
  seat          smallint NOT NULL,
  player_id     uuid REFERENCES players(id),  -- null for bots
  bot_name      text,
  placement     smallint NOT NULL,
  lives_left    smallint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_players_player ON match_players (player_id, match_id DESC) WHERE player_id IS NOT NULL;

CREATE TABLE admins (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  username      text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash text NOT NULL,                -- Bun.password (argon2id)
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  token_hash    bytea PRIMARY KEY,            -- sha256(token)
  admin_id      uuid NOT NULL REFERENCES admins(id),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  admin_id      uuid REFERENCES admins(id),   -- null for a failed login
  action        text NOT NULL,                -- 'login', 'login_failed', 'player.disable', …
  target_id     uuid,
  detail        jsonb NOT NULL DEFAULT '{}',
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- updated_at is kept current by the database, so no query can forget it.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['players','player_secrets','matches','match_players','admins','admin_sessions','admin_audit'] LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
```

Every table has `created_at` and `updated_at` (`timestamptz`, UTC). New tables follow the same rule: add both columns and the trigger in the same migration.

Match history is never deleted. Bot matches are stored like the rest; Phase 2 stats can show "all games" and "vs humans" from the same rows.

Backups: nightly `pg_dump` from a cron container to off-VPS storage, kept 14 days. Restoring one is tested before launch.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | platform | Postgres connection |
| `PLAY_TOKEN_PRIVATE_KEY` | platform | Ed25519 private key (JWK) that signs play tokens |
| `PLATFORM_SERVER_KEY` | platform + actor server | Bearer key for actor → platform calls |
| `ALLOWED_ORIGINS` | platform | Comma-separated origins allowed by CORS (game frontend) |
| `PLAY_TOKEN_PUBLIC_KEY` | actor server | Public key that verifies play tokens |
| `PLATFORM_URL` | actor server | `http://platform:3000` (private network) |
| `INTERNAL_ACTOR_KEY` | actor server | Guards the room list's `report` / `remove` |
| `DATABASE_URL` (backoffice) | backoffice | Postgres connection as the `backoffice` role |
| `PUBLIC_PLATFORM_URL` | game frontend | `https://api.nblueclouds.online` |
| `PUBLIC_RIVET_ENDPOINT` | game frontend | `https://engine.nblueclouds.online` (already exists) |
| `DOMAIN` | Caddy | `nblueclouds.online`; hostnames are built from it |
| `ALLOWED_ORIGINS` value | platform | `https://nblueclouds.online` |

Each app validates its variables at startup and exits if one is missing. `bun run keys:generate` prints a fresh Ed25519 key pair. `.env.example` files list only these keys.

## Repo changes (MVP)

```
apps/
  platform/            # new: Bun API
    src/
      index.ts         # Hono app: cors, requestId, bodyLimit, secureHeaders, onError, route mounting
      http.ts          # ok() / fail() envelope helpers
      config.ts        # env validation
      players/         # routes + service + queries
      matches/
      tokens.ts        # play token signing (jose)
    migrations/        # 001_init.sql, …
    scripts/           # migrate.ts, keys-generate.ts
    Dockerfile
  backoffice/          # new: SvelteKit admin UI, server code talks to Postgres
    scripts/admin-create.ts
  server/              # actor changes below
  web/                 # adapter-node, guest.ts, connection.svelte.ts
deploy/
  compose.yml          # caddy, web, rivet-engine, actors, platform, backoffice, postgres, backup
  Caddyfile
```

| File | Change |
|---|---|
| `apps/server/src/platform.ts` (new) | `verifyPlayToken`, `reportMatch` + outbox retry |
| `bust-31/schema.ts` | `ConnParams` → `{ playToken }` |
| `bust-31/actor.ts` | Verify in `onBeforeConnect`, `conn.id → playerId` map, `matchId` at start, outbox on finish, drop stored secrets |
| `bust-31/directory.ts` | `internalKey` check on `report` / `remove` |
| `apps/web/vite.config.ts` + `package.json` | `adapter-vercel` → `adapter-node`, plus a Dockerfile |
| `apps/web/src/lib/guest.ts` | Calls `/v1/players/guest` and `/v1/play-tokens`, keeps the player secret |
| `apps/web/src/lib/games/bust-31/connection.svelte.ts` | Gets a play token before connecting |

The web app's name modal and leave-on-close work is already committed, so these changes build on top of it. Existing rooms are short-lived and nothing is stored per player today, so there is no data to migrate.

## Security notes

- A guest is only as safe as the browser's `localStorage`: clearing it loses the player, and an XSS bug on the game site could read the secret. Phase 3 accounts fix the first; a strict CSP on the game site limits the second.
- Secrets, tokens and passwords are never logged; only hashes are stored.
- Request bodies capped at 16 KB (Hono `bodyLimit`). Actor → platform calls time out after 5 s.
- Rate limits are in-process (one platform instance). ponytail: move them to DragonflyDB if the platform ever runs more than one instance.
- There is no admin API anywhere; admin actions only exist as backoffice form actions behind an admin session.
- The VPS firewall only opens 80/443 (and SSH by key, no password login). Postgres, the engine's internal ports and the actor runner are never published.
- Everything runs on one machine, so it is also one point of failure. Backups go off the VPS; a restore is rehearsed before launch.

## Checks to leave behind

- Every platform endpoint returns the envelope, including thrown errors.
- Matches: new → 201, exact retry → 200, changed body → 409, unknown player → 422.
- Play tokens: valid accepted; expired, wrong audience, wrong key rejected; disabled player gets `403`.
- Backoffice: wrong password → `login_failed` audit row; disable revokes secrets + writes an audit row in one transaction; the `backoffice` role cannot `UPDATE players.display_name` or read `secret_hash`.
- Room: a connection without a valid token is refused; a finished game writes exactly one outbox row.

## Open questions

None left for the MVP design. Items marked "to verify" (Rivet self-hosting details, WebSocket host) get checked at the start of the build.
