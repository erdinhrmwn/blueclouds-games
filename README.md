# BlueClouds Games

Multiplayer, turn-based browser games. The game server runs on Rivet Actors (one actor type per game, one actor per room); the frontend is SvelteKit.

Games so far: **Bust 31**.

## Bust 31 rules

- 2–6 players (bots allowed). Everyone has 3 lives and holds 3 cards.
- Take turns playing 1 card. Its value is added to the shared total, then you draw a new card.
- Whoever pushes the total **over 31** loses a life, and a new round is dealt.
- Cards: numbers 1–9, **0** (skip), **−5** (lower the total, never below 0), **⇄** (reverse the turn order).
- The last player with lives left wins.
- Each human turn is limited to 20 seconds (`TURN_MS` in `rules.ts`). When it runs out, the server plays a card for you using the bot strategy.

## Running

Needs [Bun](https://bun.sh) 1.3+. See `DESIGN.md` for the UI design reasoning.

```sh
bun install
bun run dev        # server (local Rivet engine on :6420) + web (:5173)
bun run test       # game rule tests
bun run check      # type-check server + web
```

Open http://localhost:5173, pick a game, enter a name, open a table and share its code. The host can add bots to play alone.

## Configuration

| Variable | Used in | Default |
|---|---|---|
| `PUBLIC_RIVET_ENDPOINT` | `apps/web` | `http://127.0.0.1:6420` |

## Structure

```
apps/server/src/
  index.ts
  registry.ts          # registers one actor type per game
  games/bust-31/
    actor.ts           # room actor: state (SQLite), actions, broadcast, turn/bot timers
    rules.ts           # pure game rules
    bots.ts            # rule-based bot strategy
    schema.ts          # Zod validation for player input
    rules.test.ts
apps/web/src/
  lib/games/catalog.ts # list of games: slug, name, player counts, Home + Room components
  lib/games/bust-31/   # game UI: Home, Room, Lobby, Table, cards, connection to its actor
  lib/components/      # shared table pieces: Felt, Seat
  lib/rivet/client.ts  # typed Rivet client
  lib/guest.ts         # guest identity (token + name in localStorage)
  lib/motion.ts        # shared animations
  routes/              # / (pick a game), /[game], /[game]/room/[code]
```

### Adding a game

1. Server: add `apps/server/src/games/<slug>/` with its actor and rules, and register the actor in `registry.ts`.
2. Web: add `apps/web/src/lib/games/<slug>/` with a `Home` and `Room` component, and add an entry to `catalog.ts`.

## Security notes (prototype)

- No login. Guest identity is a random token in localStorage; whoever holds that token can play as that player.
- A hand is only sent to its owner; the deck and other players' hands never reach the browser.
