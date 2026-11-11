# Game frontend (`apps/web`)

SvelteKit app the players use. Started with `bun run dev:web` on http://localhost:5173. Pick a game, enter a name, open a table and share its code. The host can add bots to play alone.

## Configuration

| Variable | Default |
|---|---|
| `PUBLIC_RIVET_ENDPOINT` | `http://127.0.0.1:6420` |
| `PLATFORM_URL` | `http://127.0.0.1:3000` (server side only: the browser never calls the platform) |

Set in the root `.env` (template: `.env.example`; `vite.config.ts` points SvelteKit at the repo root). Optional for local dev.

Production: `bun run build`, then `bun run start` (adapter-node output, run on Bun). It also needs `ORIGIN` (the public URL) and, behind Caddy, `ADDRESS_HEADER=X-Forwarded-For` so the player's IP reaches the platform's rate limit.

## Structure

```
apps/web/src/
  lib/games/catalog.ts # list of games: slug, name, player counts, Home + Room components
  lib/games/bust-31/   # game UI: Home, Room, Lobby, Table, cards, connection to its actor
  lib/components/      # shared table pieces: Felt, Seat
  lib/rivet/client.ts  # typed Rivet client
  lib/platform.ts      # browser side: calls our /api routes
  lib/server/platform.ts # server side: calls the platform, keeps the player secret in an httpOnly cookie
  lib/guest.ts         # display name in localStorage
  lib/player.svelte.ts # player name shared by the name dialog; play tokens for rooms
  lib/motion.ts        # shared animations
  routes/              # / (pick a game), /[game], /[game]/room/[code], api/player, api/play-token
```
