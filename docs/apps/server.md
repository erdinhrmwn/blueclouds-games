# Game server (`apps/server`)

Rivet Actors: one actor type per game, one actor per room (keyed by the room code). Started with `bun run dev:server`, which boots a local Rivet engine on `:6420`. Players sign in through the platform, so run `bun run dev:platform` too.

## Configuration

| Variable | Purpose |
|---|---|
| `PLAY_TOKEN_PUBLIC_KEY` | Ed25519 public key (43-char base64url) that checks the platform's play tokens |
| `PLATFORM_URL` | Platform API as the actors reach it (default `http://127.0.0.1:3000`) |
| `PLATFORM_SERVER_KEY` | Bearer key for match reports, same as the platform's |
| `RIVET_TOKEN` | Engine admin token. In dev, `bun run dev` also gives it to the local engine RivetKit starts, so dev checks tokens like production |
| `RIVET_ENDPOINT` | Engine to connect to as a runner. Unset in dev: RivetKit starts a local engine |
| `LOG_LEVEL` | pino level for `core/adapters/log.ts` (default `info`). RivetKit logs through the same logger (`logging.baseLogger`), so this also sets `c.log` and RivetKit's own logs, which otherwise default to `warn` |

Set in the root `.env`; checked at startup.

## Structure

Four layers. Each one imports only from the layers above it in this list (and from `contracts/`), never below:

1. **Domain** (`core/domain/`): types only. Branded ids (`PlayerId`, `MatchId`, branded once where they enter the server), the shared table with one shape per phase (`InLobby`, `InPlay`, `Finished`: only a finished game has a winner), match and room records, the `GameDefinition` every game implements, and the ports (interfaces) the room needs from the outside world: `PlatformPort`, `RoomStorePort`, `RoomListPort`.
2. **Rules** (`core/rules/`, and each game's `rules.ts`, `bots.ts`, `match.ts`): pure functions. No Rivet, no I/O, no clock unless passed in.
3. **Room** (`core/room/`, and each game's `room.ts`): the Rivet actor. Validates input, calls the rules, saves, broadcasts, schedules. It sees the outside world only through the ports.
4. **Adapters** (`core/adapters/`): the ports' implementations: the room's SQLite, the platform's HTTP API, the room lists, the logger. `create-room.ts` is the one place that wires them in.

```
apps/server/src/
  index.ts
  registry.ts            # registers one room actor per game, and the room lists
  room-list.ts           # room list actor ("Open tables"), one instance per game slug
  contracts.check.ts     # compile-time proof that the actors match contracts/rooms
  core/
    domain/              # ids.ts (PlayerId, MatchId), table.ts (phases), match.ts, room.ts,
                         # game.ts (GameDefinition), ports.ts
    rules/               # table.ts (seats, shuffle), match.ts (log, report), rounds.ts, fair-rng.ts,
                         # turn.ts (turn clock plan), tournament.ts, views.ts, listing.ts
    room/
      create-room.ts     # createRoom(game, moves): the room actor for any GameDefinition
      context.ts         # the parts of a Rivet context the room uses (RoomCtx, ActionCtx)
      access.ts          # sign-in, who may do what
      commit.ts          # save + move log + round and match outbox, then broadcast
      turn.ts, tournament.ts, moderation.ts, vip.ts, reports.ts, listing.ts, state.ts
      inputs.ts          # Zod validation for connection params, seats, admin input
      fakes.ts           # fake ports for tests
    adapters/            # room-store.ts (SQLite), platform.ts (HTTP), room-lists.ts, log.ts, ports.ts
  games/<slug>/
    domain.ts            # the game's state, match record and Action union
    rules.ts             # pure game rules, applyAction
    bots.ts              # rule-based bot strategy
    match.ts             # move log events and match result sent to the platform
    definition.ts        # the game's GameDefinition
    inputs.ts            # Zod validation for its moves
    room.ts              # createRoom(definition, moves)
```

Tests sit next to the file they test and pass fake ports (`core/room/fakes.ts`) instead of mocking modules.

## Security notes (prototype)

- A connection needs a play token from the platform (15 minutes, signed with Ed25519). The room uses its player id and name; the browser can't pick either.
- Every commit of a running match appends its move log events (`logEvents` in `match.ts`) to the room's `match_events` table, in the same transaction as the room state.
- A finished game's result and full move log go into an outbox table in the room's SQLite, then to the platform (`POST /v1/matches`), retried with backoff until it is stored. The platform ignores a repeated report, so a retry is always safe.
- A hand is only sent to its owner; the deck and other players' hands never reach the browser.
- Browsers can't reach the room list. Their engine tokens only reach one room; the game's server reads the list.
