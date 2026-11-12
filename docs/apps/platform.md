# Platform API (`apps/platform`)

The player + match API: Hono on Bun, Postgres. It has no UI and no admin API, and only the game's server and the actors call it (private network, no CORS). Full design: [architecture/platform-api.md](../architecture/platform-api.md).

## Running

```sh
docker compose up -d                      # Postgres 18 + DragonflyDB on 127.0.0.1; reads DATABASE_* from .env
cp .env.example .env                      # dev defaults; add the play token keys
bun run --filter platform keys:generate   # prints PLAY_TOKEN_PRIVATE_KEY / PLAY_TOKEN_PUBLIC_KEY
bun run --filter platform db:migrate
bun run dev:platform                      # http://localhost:3000/v1/health
```

Platform tests use the same `DATABASE_*` server with `DATABASE_TEST_NAME` as the database. It must be a throwaway database (its schema is dropped on every run) and differ from `DATABASE_NAME`. The dev Postgres in `compose.yaml` creates one, `platform_test`, on first start. Docker is optional: any Postgres 18 works.

`docker compose down` stops the services; add `-v` to also delete their data.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | Postgres 18 connection (port defaults to 5432; password may be empty) |
| `DATABASE_TEST_NAME` | Tests only: throwaway database on the same server |
| `PLAY_TOKEN_PRIVATE_KEY` | Ed25519 private key (43-char base64url seed) that signs play tokens |
| `PLATFORM_SERVER_KEY` | Bearer key the actor server sends with match reports (32+ chars) |
| `PLATFORM_HOST` | Listen interface (default `127.0.0.1`; `0.0.0.0` inside a container) |
| `PLATFORM_PORT` | Listen port (default `3000`) |

All keys live in the root `.env` (template: `.env.example`); the package scripts load it with `--env-file`. The app refuses to start if one is missing or invalid.

## Endpoints

| Method + path | Auth | What |
|---|---|---|
| `GET /v1/health` | — | Process and database are up |
| `POST /v1/players/guest` | — (5/min per IP) | New guest player; returns `playerSecret` once |
| `GET /v1/players/me` | Player secret | Current player |
| `PATCH /v1/players/me` | Player secret | Rename |
| `POST /v1/play-tokens` | Player secret | 15-minute token for room actors |
| `GET /v1/players/me/matches` | Player secret | Own match history, cursor paging |
| `POST /v1/matches` | Server key | Report a finished match with its move log (idempotent by `matchId`, body up to 512 KB) |

Every response uses the `{ ok, data, error }` envelope described in the design.

## Database

The platform owns the schema and runs every migration, including the backoffice's tables (`admins`, `admin_sessions`, `admin_audit_events`). The backoffice connects with the same `DATABASE_*` settings.

## Structure

Layered, two layers: a route handles HTTP, a service holds the rules and the SQL.

```
apps/platform/
  src/
    index.ts        # starts the server and the jobs, shuts down cleanly
    app.ts          # Hono app: middleware, mounts the routes, error envelope, /v1/health
    config.ts       # env validation
    test-helpers.ts # test database + app (the backoffice tests use it too)
    routes/         # HTTP only: Zod input schemas, auth, rate limits, status codes, ok(c, …)
      players.ts  rooms.ts  tournaments.ts  matches.ts   (+ *.test.ts, through the HTTP API)
    services/       # business rules + SQL, as plain functions taking `sql` first
      players.ts  guests.ts  rooms.ts  tournaments.ts  matches.ts
    middleware/     # auth.ts (player secret, server key), rate-limit.ts
    jobs/           # in-process loops: tournament-job.ts (30 s), guest-sweep.ts (daily)
    lib/            # http.ts (envelope, ApiError, parse), log.ts, secrets.ts, play-tokens.ts
    db/             # migrate.ts (runner), schema.test.ts
  migrations/       # NNN_name.sql, applied in order
  scripts/          # migrate.ts, keys-generate.ts
```

Rules of the layout:

- A route never runs SQL; it parses input, calls one service and shapes the response. A service never sees Hono's `Context`.
- Services throw `ApiError` (from `lib/http.ts`) for anything the caller should see, so there is no second error type to map.
- There is no repository layer: the queries are short and each runs in one place, so it would only pass calls through. If one service's SQL grows large, give that service its own file of queries.
- A schema the service also depends on lives with the service (`MatchReport` in `services/matches.ts`, since the stored hash is built from it); every other input schema lives in its route.
- No index files: import the file you need.
- To add an endpoint: put the handler in `routes/<feature>.ts`, its logic in `services/<feature>.ts`, and a test next to the route. A new feature gets one file in each folder and is mounted in `app.ts`.
