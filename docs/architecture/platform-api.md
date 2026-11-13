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
| Hostnames | Game `nblueclouds.online`, backoffice `backoffice.nblueclouds.online`, engine `engine.nblueclouds.online`. The platform has no public hostname (Erdin, 2026-11-11): the game's SvelteKit server calls it on the internal network |
| First admin | Username `root` |
| Responsibility | Platform = player + match API only. Backoffice = separate app, no admin API on the platform |
| Bot matches | Recorded in history like any other match |
| Move log | Every match records every move for replay and audit: see [match-log.md](match-log.md) |
| Match data | One generic schema for every game (`games` catalog, per-seat `placement` + game-defined `score`): see [match-schema.md](match-schema.md) |
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
                ├─ backoffice.<domain>      → backoffice  (SvelteKit adapter-node)
                └─ engine.<domain>          → rivet-engine (rooms: HTTP + WebSocket)
                                                 ▲
                              actors (apps/server) ── runner connection
                                │
               web, actors ─────┴──▶ http://platform:3000  (private network, never published)
               platform ──▶ postgres (private network)
               backoffice ──▶ postgres (same user as platform)
```

| Container | What | Reachable from |
|---|---|---|
| `caddy` | TLS (automatic HTTPS) + routing | Internet (80/443) |
| `web` | Game frontend (today's `apps/web`, switched from `adapter-vercel` to `adapter-node`) | Caddy |
| `rivet-engine` | Self-hosted Rivet Engine (single node) | Caddy, actors |
| `actors` | `apps/server`: room + directory actors, connected to the engine as a runner | Engine only |
| `platform` | `apps/platform`: `/v1` player + server API | web, actors (private network only) |
| `backoffice` | `apps/backoffice`: admin UI + its own server code, reads Postgres directly | Caddy |
| `postgres` | Postgres 18, platform data | platform, backoffice (same user) |
| `backup` | Nightly `pg_dump` + engine data snapshot to off-VPS storage | — |

- **platform** serves only the player and server API, and only on the private network. It has no admin routes and no public hostname. Browsers talk to the game's own `/api/*` routes; the `web` container calls the platform for them.
- **backoffice** uses SvelteKit server code (`+page.server.ts` loads and form actions) that queries Postgres directly with the same database user as the platform (Erdin's call, 2026-11-11: one user is simpler to run).
- **Migrations have one owner:** the platform. The backoffice never changes the schema; it reads the same tables.
- **Actors → platform** go over the private network (`http://platform:3000`), so match reports never leave the VPS. The server key is still checked.
- Actors talk to the platform through one module, `apps/server/src/platform.ts` (`verifyPlayToken`, `reportMatch`), so game code never knows the platform's URL or format.

**Hostnames** (`<domain>` = `nblueclouds.online`):

| Host | Serves |
|---|---|
| `nblueclouds.online` | Game frontend |
| `backoffice.nblueclouds.online` | Backoffice |
| `engine.nblueclouds.online` | Rivet engine: room actions over HTTP and live updates over WebSocket |

**To verify against the Rivet docs before building:** the self-hosted engine image and its storage options, how `apps/server` connects to it as a runner, and what the engine's data volume needs for backups. The design does not depend on the answers.

### Tech stack

| Part | Choice | Notes |
|---|---|---|
| Platform runtime | Bun 1.3 | |
| HTTP framework | Hono 4 (`@hono/bun` adapter) | Built-in middleware covers body limit, request id and secure headers; `app.onError` / `app.notFound` force the envelope; `app.request()` makes route tests easy. Zero transitive deps. |
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
- One helper (`ok(data, status)` / `fail(code, status, message, fields?)` in `apps/platform/src/lib/http.ts`) builds every response, and Hono's `app.onError` / `app.notFound` turn any thrown error or unknown route into the envelope (`internal` / `not_found`), so the shape cannot drift. Zod is called through one small `parse(schema, body)` helper that throws `bad_input` with `fields`, so no extra validator package is needed.

| `error.code` | Status | When |
|---|---|---|
| `bad_input` | 400 | Body or query fails validation |
| `unauthenticated` | 401 | Missing or invalid credential |
| `forbidden` | 403 | Authenticated but not allowed (e.g. disabled player) |
| `not_found` | 404 | Unknown resource |
| `conflict` | 409 | Same `matchId`, different body |
| `unknown_player` | 422 | Match references a player that does not exist |
| `payload_too_large` | 413 | Body over 16 KB (512 KB for `POST /v1/matches`) |
| `rate_limited` | 429 | Too many requests |
| `internal` | 500 | Anything unexpected (generic message) |

The examples below show only `data`; the envelope around it is implied.

## Player auth flow

Browsers never reach the platform. The game's SvelteKit server (`web`) holds the player secret in a cookie and calls the platform over the private network with it as a bearer credential.

| Credential | Stored where | Lifetime | Used for |
|---|---|---|---|
| **Player secret** (32 random bytes, base64url) | `player_secret` cookie on the game domain: `httpOnly`, `Secure`, `SameSite=Lax`. Page scripts can't read it. The platform stores only its SHA-256 | Until revoked | `web` → platform `Authorization: Bearer` |
| **Play token** (EdDSA JWT) | Browser memory only | 15 minutes | Connecting to a room actor |

```
Browser                    web (SvelteKit server)          Platform (private)          Room actor (Rivet)
  | POST /api/player {name}     |                                |                             |
  |---------------------------->| POST /v1/players/guest         |                             |
  |                             |------------------------------->| create player + secret      |
  |<-- Set-Cookie player_secret |<-- {player, playerSecret} -----|                             |
  | POST /api/play-token        |                                |                             |
  |---------------------------->| POST /v1/play-tokens (Bearer)  |                             |
  |                             |------------------------------->| check secret, not disabled, |
  |<-- {token} -----------------|<-- {token, expiresAt} ---------| sign {sub, name, aud, exp}  |
  | connect(params: {playToken}) via engine.<domain>                                           |
  |------------------------------------------------------------------------------------------->| verify with PUBLIC key
```

- Actors verify play tokens **locally** with the public key: no network call per connection, and a platform outage does not break running games.
- Only the platform holds the private key. A leaked actor env cannot mint tokens.
- A room maps `conn.id → playerId` in `c.vars`; actions use that map. The name comes from the token, not the client.
- Disabling a player revokes their secrets. The platform answers a disabled player's secret with `403`, so the game can say why. A connection that is already open stays until it closes (at most one game); the 15-minute token limits reconnects.
- No CORS: the platform never answers browsers. `web` puts the player's IP in `X-Forwarded-For`, which the platform trusts for the guest rate limit because nothing else can reach it.
- The game's `/api/*` routes take JSON only; a cross-site page can't send that with the cookie (`SameSite=Lax` plus the CORS preflight it would need).

Server-to-server calls (actor → platform) use `Authorization: Bearer <PLATFORM_SERVER_KEY>`, compared in constant time.

## Public API (MVP)

### `POST /v1/players/guest`

Request: `{}` (the game's "Play as guest" button) or `{ "name": "Rina" }` (trimmed, 1–20 chars). Without a name the platform makes one up: `Guest 482193`, with username `guest_482193` (a random 6-digit number, drawn again on a clash). The username is always generated; a guest has no password, so it can't log in with it.

`201`, `data: { "player": { "id": "uuidv7", "name": "Guest 482193", "username": "guest_482193", "guest": true, "createdAt": "…" }, "playerSecret": "…" }`. The secret is shown only in this response.

Errors: `400 bad_input`, `429 rate_limited` (5/min per IP).

### `GET /v1/players/me`

Bearer player secret. `200`, `data: { "player": {…} }`; `401 unauthenticated`; `403 forbidden` if disabled.

### `PATCH /v1/players/me`

Bearer player secret. Request `{ "name": "Rina K" }`. `200`, `data: { "player": {…} }`; `403 forbidden` for a guest, which keeps its generated name until it links an account. The profile page's rename dialog calls this; rooms pick up the new name at the next connect.

### `POST /v1/play-tokens`

Bearer player secret, no body. `200`, `data: { "token": "eyJ…", "expiresAt": "…" }`. Claims: `sub` (player id), `name`, `aud: "blueclouds-rooms"`, `iat`, `exp`.

### `POST /v1/players/register`, `POST /v1/players/login`, `POST /v1/players/logout`

Player accounts (migration `011`). Register takes `{ "name", "username", "password" }`: with a guest's bearer secret it turns that guest into the account (same id and secret, `200`); without one it makes a new player and returns its secret (`201`). Login takes `{ "username", "password" }` and returns a new secret for this device. Logout revokes the bearer secret; a guest that never played a match is deleted then, since nothing can reach it again. The platform also sweeps daily at 03:00 WIB (`src/jobs/index.ts`): guests with no match, tournament sign-up, seat or audit entry, unseen for 30 days, are deleted. `GET /players/me` counts as being seen (one write an hour at most). Guests that played stay, so every match keeps all its players. Usernames are stored lowercase, and ones starting with `guest` are kept for guests (migration `012`). Errors: `400 bad_input` per field, `409 conflict` (username taken, or already an account), `401` wrong username or password (same answer for an unknown username), `403` disabled, `429` rate limited or 5 wrong passwords in 15 minutes.

### Rooms and tournaments

`POST /v1/rooms`, `GET /v1/rooms/:code`, `POST /v1/rooms/:code/invites`, `DELETE /v1/rooms/:code/invites/link`, `POST /v1/invites/redeem`, `GET /v1/tournaments?game=`, `POST`/`DELETE /v1/tournaments/:id/registration` and `GET /v1/players/me/rooms` take the player secret; the room actor uses `GET /v1/rooms/:code/seats`, `POST /v1/rooms/:code/start` and `POST /v1/rooms/:code/close` with the server key. What each does is in [database.md](database.md#where-it-lives-in-the-code).

### `GET /v1/players/me/matches?cursor=…`

Bearer player secret. The player's own history, newest first, 20 per page: `data: { "matches": [...], "nextCursor": "…" | null }`. Cheap to add because the table already exists, and it lets the game show "your last games".

### `GET /v1/matches/:matchId/rounds`

Bearer player secret. Matches are public: any signed-in player may read any match. A match's closed rounds, oldest first, running or finished: `data: { "match": { "id", "game", "finished" }, "rounds": [{ "id", "round", "startedAt", "endedAt", "result", "serverSeedHash", "serverSeed", "shuffles": [{ "nonce", "clientSeed", "deck" }] }] }`. 404 when the match has neither a report nor a round. See [fairness.md](fairness.md#round-history).

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
  "endReason": "finished",
  "players": [
    { "seat": 0, "playerId": "uuidv7", "bot": false, "placement": 1, "score": 2 },
    { "seat": 3, "playerId": null, "bot": true, "botName": "Bot Rain", "placement": 2, "score": 0 }
  ],
  "log": { "logVersion": 1, "events": [{ "seq": 0, "t": 0, "type": "deal", "data": { "…": "…" } }] }
}
```

`score` (0–999) is a per-seat number each game defines (Bust 31 sends lives left). Rankings use `placement`; `score` is only shown.

`endReason` is `finished` (the default when left out) or `terminated`: an admin terminated the table mid-match from the backoffice's Live tables. A terminated match is placed by the standings when it stopped (ties split by seat, so there is still one first place), its log ends with a `terminated` event, and it counts no win (`matches.end_reason`). The hash of a finished report leaves `endReason` out, as reports did before it existed.

**Idempotent by `matchId`:**

| Case | Response |
|---|---|
| New `matchId` | `201`, `data: { "match": { "id": …, "created": true } }` |
| Same `matchId`, same body (retry) | `200`, `data: { "match": { "id": …, "created": false } }` |
| Same `matchId`, different body | `409 conflict` (logged; a bug, not a retry) |

"Same body" = SHA-256 of the canonical JSON, stored on the row. `INSERT … ON CONFLICT (id) DO NOTHING`, then compare hashes, in one transaction with the `match_players` rows and the `match_logs` row. The hash covers the log too. The log's format and checks are in [match-log.md](match-log.md).

Validation: `game` must be a row in `games` and the seat count within its limits, a bot seat needs `botName`, `score` is any integer the game defines (see [match-schema.md](match-schema.md)), seats unique, exactly one `placement: 1`, every non-bot `playerId` must exist (`422 unknown_player`). Matches against bots only are recorded too.

**Actor side (outbox):** on `finished`, the room saves `{matchId, body}` (result and full move log) to a `match_reports` row in its own SQLite, then calls the API. On failure it retries with `c.schedule.after` (10s, 1m, 5m, 30m, then 6h until it succeeds, logging each failure). Because the endpoint is idempotent, a retry after a timeout that actually succeeded is harmless. A finished game never waits on this call.

### `POST /v1/matches/:matchId/rounds`

Called by a room actor when a round closes, before the match's own report. Bearer `PLATFORM_SERVER_KEY`. Body: `roundId` (UUIDv7, made with the round's seed), `game`, `roomCode`, `round`, `serverSeedHash`, `serverSeed`, `shuffles: [{ nonce, clientSeed, deck }]`, `result` (the game's own summary), `startedAt`, `endedAt`. 400 when the seed misses its hash, a client seed is not `matchId:round:nonce` or the nonces are not 0, 1, 2…; 201 stored, 200 for the same body again, 409 for another body for the same round, a round id used twice, or another room than the match's earlier rounds.

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
- Every admin write (login, failed login, logout, disable, enable, VIP, tournament changes) writes one `admin_audit_events` row: who, what, which player, tournament or room, detail, time, IP.
- One role in MVP (`admin`). Viewer/admin roles and TOTP 2FA come in Phase 2.

### Database access

The backoffice uses the platform's database user (`DATABASE_*`). The platform still owns every migration, including the admin tables. With one user, the backoffice's queries are the only guard: they only change `disabled_at`, `disabled_reason` and `revoked_at` on player data.

Trade-off of skipping an admin API: the backoffice depends on the table layout, so a schema change has to check both apps. With one repo, one migration owner and only a handful of backoffice queries, that is cheaper than maintaining a second API. If another tool ever needs admin actions, that is the moment to add an admin API.

## Locking the room list

Browsers never reach the room list actor. The game's server issues each browser an engine token for one room only (`POST /api/:game/rooms/:code/token`, a grant on that actor's id), and it reads the list itself for `GET /api/:game/rooms`. Rooms update the list over `c.client()` with the actor server's admin token. Rivet doesn't tell an actor who is calling, so this per-room token is what keeps browsers off `report` / `remove`.

## Data store

The full schema, its rules and the migration path are in [database.md](database.md).

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | platform + backoffice | Postgres connection |
| `PLAY_TOKEN_PRIVATE_KEY` | platform | Ed25519 private key (32-byte seed, base64url) that signs play tokens |
| `PLATFORM_SERVER_KEY` | platform + actor server | Bearer key for actor → platform calls |
| `PLAY_TOKEN_PUBLIC_KEY` | actor server | Ed25519 public key (32 bytes, base64url) that verifies play tokens |
| `PLATFORM_URL` | game frontend (server side) + actor server | `http://platform:3000` (private network) |
| `RIVET_TOKEN` | game frontend (server side) + actor server | Engine admin token; the game's server turns it into per-room browser tokens |
| `PUBLIC_RIVET_ENDPOINT` | game frontend | `https://engine.nblueclouds.online` (already exists) |
| `LOG_LEVEL` | every app | Least severe pino level written (`trace` … `fatal`, `silent`); default `info`. Each app configures its own pino logger: readable lines via `pino-pretty` in dev, JSON lines when `NODE_ENV=production` (the Dockerfile sets it) or in a SvelteKit build |
| `DOMAIN` | Caddy | `nblueclouds.online`; hostnames are built from it |

Each app validates its variables at startup and exits if one is missing. `bun run keys:generate` prints a fresh Ed25519 key pair. All apps read one root `.env` (template `.env.example`). Keys used by one app carry its prefix (`PLATFORM_`); keys several apps share (`DATABASE_*`, `PLAY_TOKEN_*`, `PLATFORM_SERVER_KEY`) have no app prefix.

## Repo changes (MVP)

```
apps/
  platform/            # new: Bun API
    src/
      app.ts           # Hono app: requestId, bodyLimit, secureHeaders, onError, route mounting
      config.ts        # env validation
      routes/          # HTTP: input schemas, auth, responses
      services/        # rules + SQL
      lib/             # http.ts envelope helpers, play-tokens.ts (jose), …
                       # full layout: docs/apps/platform.md
    migrations/        # 001_functions.sql, …
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
| `shared/directory.ts` | Unreachable from browsers: per-room engine tokens |
| `apps/web/vite.config.ts` + `package.json` | `adapter-vercel` → `adapter-node`, plus a Dockerfile |
| `apps/web/src/lib/guest.ts` | Calls `/v1/players/guest` and `/v1/play-tokens`, keeps the player secret |
| `apps/web/src/lib/games/bust-31/connection.svelte.ts` | Gets a play token before connecting |

The web app's name modal and leave-on-close work is already committed, so these changes build on top of it. Existing rooms are short-lived and nothing is stored per player today, so there is no data to migrate.

## Security notes

- A guest is only as safe as the browser's cookie: clearing site data loses the player. Phase 3 accounts fix that. The cookie is `httpOnly`, so an XSS bug can't read the secret (it could still act as the player while the page is open).
- Secrets, tokens and passwords are never logged; only hashes are stored.
- Request bodies capped at 16 KB (Hono `bodyLimit`), 512 KB for match reports because they carry the move log. Actor → platform calls time out after 5 s.
- Rate limits are in-process (one platform instance). ponytail: move them to DragonflyDB if the platform ever runs more than one instance.
- There is no admin API anywhere; admin actions only exist as backoffice form actions behind an admin session.
- The VPS firewall only opens 80/443 (and SSH by key, no password login). Postgres, the engine's internal ports and the actor runner are never published.
- Everything runs on one machine, so it is also one point of failure. Backups go off the VPS; a restore is rehearsed before launch.

## Checks to leave behind

- Every platform endpoint returns the envelope, including thrown errors.
- Matches: new → 201, exact retry → 200, changed body → 409, unknown player → 422.
- Play tokens: valid accepted; expired, wrong audience, wrong key rejected; disabled player gets `403`.
- Backoffice: wrong password → `login_failed` audit row; disable revokes secrets + writes an audit row in one transaction.
- Room: a connection without a valid token is refused; a finished game writes exactly one outbox row.

## Open questions

None left for the MVP design. Items marked "to verify" (Rivet self-hosting details, WebSocket host) get checked at the start of the build.
