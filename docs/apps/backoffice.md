# Backoffice (`apps/backoffice`)

Admin UI for staff: SvelteKit (`adapter-node`) running on Bun. It has no API of its own and the platform has no admin API: pages read Postgres in `+page.server.ts` and change it through form actions, with the same database settings as the platform (`DATABASE_*`). Design: [architecture/platform-api.md](../architecture/platform-api.md#backoffice-mvp).

## Screens

| Screen | What |
|---|---|
| Players | Search by name or id; detail with status and recent matches; disable (with a reason) / enable |
| Matches | Filter by game, player id and UTC date range; detail with every seat, the provably fair check of every shuffle ([fairness.md](../architecture/fairness.md)) and the move replay (timeline, step slider, JSON download) |
| Tournaments | Create, register players, hand out tables, seat or take off by hand, disqualify a player with a reason (audited), cancel. Withdrawn and disqualified players are listed apart |
| Games | Start or end a game's maintenance: no new tables or tournaments while it runs, open tables play on. Audited |
| Audit log | Every admin sign-in and change, newest first |

## Running

```sh
bun run --filter platform db:migrate            # creates the admin tables too
(cd apps/backoffice && bun run admin:create root)   # needs a TTY, so not --filter; asks for the password (12+ characters)
bun run dev:backoffice                          # http://localhost:5174
```

`bun --bun` runs Vite on Bun, because the server code uses `Bun.sql` and `Bun.password`. Production: `bun run build`, then `bun run start` (serves `build/`).

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | The platform's Postgres connection, shared |

Behind a proxy, adapter-node also needs `ORIGIN` (e.g. `https://backoffice.nblueclouds.online`) and `ADDRESS_HEADER=X-Forwarded-For` so form actions and the audit log see the real origin and IP.

## Security

- Sign-in: username + password (argon2id via `Bun.password`). 5 failed tries for a username within 15 minutes lock it for the rest of the window. An unknown username takes as long as a wrong password.
- Session: random 32-byte token in an `httpOnly`, `SameSite=Strict` cookie (`Secure` outside dev), 8 hours. Only its SHA-256 is stored. Disabling an admin ends their sessions at once.
- Form actions are covered by SvelteKit's CSRF origin check.
- Every sign-in, failed sign-in, sign-out and change (players, VIP, tournaments) writes an `admin_audit_events` row with the IP.
- Disabling a player revokes all their secrets in the same transaction. The platform answers their old secret with `403` ("disabled"), so the game can tell them why. Enabling clears the flag; the old secrets stay revoked, so they come back as a new guest session.
- Admins are only created with `admin:create`, which reads the password from the terminal so it never lands in shell history.

## Structure

```
apps/backoffice/
  src/
    env.ts               # DATABASE_* validation
    hooks.server.ts      # loads the admin from the session cookie, sends everyone else to /login
    lib/server/db.ts     # Bun.sql connection
    lib/server/auth.ts   # login, sessions, audit, createAdmin (+ auth.test.ts)
    lib/server/players.ts # search, detail, disable/enable (+ players.test.ts)
    lib/server/matches.ts # match list with filters, match detail, move log
    lib/replay.ts         # turns a move log into timeline steps; per-game renderers in lib/games/
    lib/server/audit-log.ts
    lib/server/history.test.ts
    routes/              # login, logout, players, matches, audit
  scripts/admin-create.ts
```

Tests (`bun run test`) use the platform's test database (`DATABASE_TEST_NAME`), migrated fresh.
