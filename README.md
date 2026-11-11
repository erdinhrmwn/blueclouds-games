# BlueClouds Games

Multiplayer, turn-based browser games. The game server runs on Rivet Actors (one actor type per game, one actor per room); the frontend is SvelteKit; the platform API keeps players and match history.

## Apps

| App | What | Docs |
|---|---|---|
| `apps/web` | Game frontend (SvelteKit) | [docs/apps/web.md](docs/apps/web.md) |
| `apps/server` | Game server: Rivet actors per game | [docs/apps/server.md](docs/apps/server.md) |
| `apps/platform` | Platform API: players, play tokens, match results (Hono, Postgres) | [docs/apps/platform.md](docs/apps/platform.md) |
| `apps/backoffice` | Admin UI for staff (SvelteKit, talks to Postgres directly) | [docs/apps/backoffice.md](docs/apps/backoffice.md) |

Deploy: one VPS with Docker Compose, see [docs/deploy.md](docs/deploy.md). Design: [the platform API design](docs/architecture/platform-api.md).

Every match records every move for replay and audit in the backoffice: [docs/architecture/match-log.md](docs/architecture/match-log.md).

## Games

| Game | Rules | Design |
|---|---|---|
| Bust 31 | [rules](docs/games/bust-31/rules.md) | [UI design](docs/games/bust-31/design.md) |

New game: [docs/adding-a-game.md](docs/adding-a-game.md).

## Running

Needs [Bun](https://bun.sh) 1.3+.

```sh
bun install
bun run dev:platform  # platform API (:3000), needs Postgres, see below
bun run dev           # server (local Rivet engine on :6420) + web (:5173)
bun run test          # game rule tests + platform API tests
bun run check         # type-check every app
```

The platform API needs Postgres: `docker compose up -d` starts Postgres 18 and DragonflyDB locally. See [docs/apps/platform.md](docs/apps/platform.md).

## Docs layout

```
docs/
  apps/             # one page per app: how to run, config, structure
  games/<slug>/     # rules.md, design.md per game
  architecture/     # designs that span several apps
  adding-a-game.md
  deploy.md         # production on one VPS
```
