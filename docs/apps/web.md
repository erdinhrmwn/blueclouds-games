# Game frontend (`apps/web`)

SvelteKit app the players use. Started with `bun run dev:web` on http://localhost:5173. Pick a game, enter a name, open a table and share its code. The host can add bots to play alone.

## Configuration

| Variable | Default |
|---|---|
| `PUBLIC_RIVET_ENDPOINT` | `http://127.0.0.1:6420` |

Template: `apps/web/.env.example` (copy to `apps/web/.env`; optional for local dev).

## Structure

```
apps/web/src/
  lib/games/catalog.ts # list of games: slug, name, player counts, Home + Room components
  lib/games/bust-31/   # game UI: Home, Room, Lobby, Table, cards, connection to its actor
  lib/components/      # shared table pieces: Felt, Seat
  lib/rivet/client.ts  # typed Rivet client
  lib/guest.ts         # guest identity (token + name in localStorage)
  lib/player.svelte.ts # player name shared by the name dialog
  lib/motion.ts        # shared animations
  routes/              # / (pick a game), /[game], /[game]/room/[code]
```
