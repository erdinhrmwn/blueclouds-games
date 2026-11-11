# Platform API (`apps/platform`)

The player + match API: Hono on Bun, Postgres. It has no UI and no admin API. Full design: [architecture/platform-api.md](../architecture/platform-api.md).

## Running

```sh
# Postgres 18 (16+ works for tests). Put the platform keys from .env.example into apps/platform/.env.
bun run --filter platform keys:generate   # prints PLAY_TOKEN_PRIVATE_KEY / PLAY_TOKEN_PUBLIC_KEY
bun run --filter platform db:migrate
bun run dev:platform                      # http://localhost:3000/v1/health
```

Platform tests need `TEST_DATABASE_URL` pointing at a throwaway database (its schema is dropped on every run).

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `PLAY_TOKEN_PRIVATE_KEY` | Ed25519 private JWK that signs play tokens |
| `PLATFORM_SERVER_KEY` | Bearer key the actor server sends with match reports (32+ chars) |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed by CORS |
| `PORT` | Listen port (default `3000`) |

The app refuses to start if one is missing or invalid.

## Endpoints

| Method + path | Auth | What |
|---|---|---|
| `GET /v1/health` | — | Process and database are up |
| `POST /v1/players/guest` | — (5/min per IP) | New guest player; returns `playerSecret` once |
| `GET /v1/players/me` | Player secret | Current player |
| `PATCH /v1/players/me` | Player secret | Rename |
| `POST /v1/play-tokens` | Player secret | 15-minute token for room actors |
| `GET /v1/players/me/matches` | Player secret | Own match history, cursor paging |
| `POST /v1/matches` | Server key | Report a finished match (idempotent by `matchId`) |

Every response uses the `{ ok, data, error }` envelope described in the design.

## Structure

```
apps/platform/
  src/
    index.ts        # starts the server
    app.ts          # Hono app: middleware, routes, error envelope
    http.ts         # ok() / fail() / parse() helpers
    config.ts       # env validation
    auth.ts         # player secret + server key auth
    tokens.ts       # play token signing
    players.ts      # guest, me, play tokens
    matches.ts      # match reports + history
    games.ts        # games the platform accepts results for
    migrate.ts      # migration runner
    *.test.ts
  migrations/       # NNN_name.sql, applied in order
  scripts/          # migrate.ts, keys-generate.ts
```
