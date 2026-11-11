# Game server (`apps/server`)

Rivet Actors: one actor type per game, one actor per room (keyed by the room code). Started with `bun run dev:server`, which boots a local Rivet engine on `:6420`. Players sign in through the platform, so run `bun run dev:platform` too.

## Configuration

| Variable | Purpose |
|---|---|
| `PLAY_TOKEN_PUBLIC_KEY` | Ed25519 public JWK that checks the platform's play tokens |
| `PLATFORM_URL` | Platform API as the actors reach it (default `http://127.0.0.1:3000`) |
| `PLATFORM_SERVER_KEY` | Bearer key for match reports, same as the platform's |
| `RIVET_TOKEN` | Engine admin token. In dev, `bun run dev` also gives it to the local engine RivetKit starts, so dev checks tokens like production |
| `RIVET_ENDPOINT` | Engine to connect to as a runner. Unset in dev: RivetKit starts a local engine |

Set in the root `.env`; checked at startup.

## Structure

```
apps/server/src/
  index.ts
  platform.ts          # everything the actors need from the platform: play token check, match reports
  registry.ts          # registers one actor type per game
  games/bust-31/
    actor.ts           # room actor: state (SQLite), actions, broadcast, turn/bot timers
    directory.ts       # room list ("Open tables"): rooms report themselves while someone is connected
    rules.ts           # pure game rules
    match.ts           # match result (placements) and move log events sent to the platform
    bots.ts            # rule-based bot strategy
    schema.ts          # Zod validation for connection params and player input
    rules.test.ts
```

## Security notes (prototype)

- A connection needs a play token from the platform (15 minutes, signed with Ed25519). The room uses its player id and name; the browser can't pick either.
- Every commit of a running match appends its move log events (`logEvents` in `match.ts`) to the room's `match_events` table, in the same transaction as the room state.
- A finished game's result and full move log go into an outbox table in the room's SQLite, then to the platform (`POST /v1/matches`), retried with backoff until it is stored. The platform ignores a repeated report, so a retry is always safe.
- A hand is only sent to its owner; the deck and other players' hands never reach the browser.
- Browsers can't reach the room list. Their engine tokens only reach one room; the game's server reads the list.
