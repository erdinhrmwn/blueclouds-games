# Game server (`apps/server`)

Rivet Actors: one actor type per game, one actor per room (keyed by the room code). Started with `bun run dev:server`, which boots a local Rivet engine on `:6420`.

## Structure

```
apps/server/src/
  index.ts
  registry.ts          # registers one actor type per game
  games/bust-31/
    actor.ts           # room actor: state (SQLite), actions, broadcast, turn/bot timers
    directory.ts       # room list ("Open tables"): rooms report themselves while someone is connected
    rules.ts           # pure game rules
    bots.ts            # rule-based bot strategy
    schema.ts          # Zod validation for player input
    rules.test.ts
```

## Security notes (prototype)

- No login. Guest identity is a random token in localStorage; whoever holds that token can play as that player.
- A hand is only sent to its owner; the deck and other players' hands never reach the browser.
- The room list's `report` action is not authenticated, so any client could add a fake listing (it cannot affect a real room). Add a shared secret once the platform has server auth.

The planned fix for both is in [the platform API design](../architecture/platform-api.md): play tokens verified by the actors, and an internal key on the room list.
