# Deploy (one VPS)

Everything runs on one VPS with Docker Compose: [deploy/compose.yml](../deploy/compose.yml). Only Caddy is reachable from outside, on ports 80 and 443. It gets and renews TLS certificates on its own.

| Host | Service |
|---|---|
| `DOMAIN` | `web`, the game |
| `backoffice.DOMAIN` | `backoffice`, staff only |
| `engine.DOMAIN` | `rivet-engine`, game websockets |

Internal only: `platform` (it runs the migrations on every start), `actors` (game rooms, connected to the engine as a runner), `postgres`, and `rivet-init` (a one-shot that creates the engine's node pool).

Browsers never get the engine admin token. The game's server gives each browser a 15-minute token that reaches one room only.

## First setup

1. Point DNS A records for `DOMAIN`, `backoffice.DOMAIN` and `engine.DOMAIN` at the VPS.
2. Install Docker with the Compose plugin, then clone the repo (for example to `/srv/blueclouds`).
3. Create `.env` at the repo root with production values. Only these keys are read:

   | Key | Value |
   |---|---|
   | `DOMAIN` | `nblueclouds.online` |
   | `DATABASE_USER`, `DATABASE_NAME` | e.g. `platform` |
   | `DATABASE_PASSWORD` | `openssl rand -hex 24` |
   | `PLAY_TOKEN_PRIVATE_KEY`, `PLAY_TOKEN_PUBLIC_KEY` | `bun run --filter platform keys:generate` (on any machine with Bun) |
   | `PLATFORM_SERVER_KEY` | `openssl rand -hex 32` |
   | `RIVET_TOKEN` | `openssl rand -hex 32` |

   Hosts, ports and internal URLs are set in `compose.yml`. Run `chmod 600 .env`.
4. Start everything with `deploy/deploy.sh`.
5. Create the first admin. It asks for the password twice and doesn't echo it:

   ```sh
   docker compose -f deploy/compose.yml --env-file .env exec -it backoffice bun scripts/admin-create.ts root
   ```

## Updating

```sh
git pull && deploy/deploy.sh
```

`deploy.sh` rebuilds the images and recreates the containers that changed. It also sets a new `RIVET_NODE_VERSION` each time, so the engine sends new rooms to the new actor server. The old actor server gets up to 130 seconds to hand its rooms over.

Logs: `docker compose -f deploy/compose.yml --env-file .env logs -f <service>`.

## Backups

None, by choice: losing the VPS disk loses players, matches and admins. For a one-off copy, run `pg_dump` inside the `postgres` container.
