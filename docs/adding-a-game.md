# Adding a game

1. Server: add `apps/server/src/games/<slug>/` with its actor and rules, and register the actor in `registry.ts`. Seats, the turn clock, leaving, the room list, the move log and the match result outbox come from `games/shared/`; the room reports to `roomList` under its slug.
2. Web: add `apps/web/src/lib/games/<slug>/` with a `Home` and `Room` component, add an entry to `catalog.ts`, and map the slug to its room actor in `lib/server/rivet.ts`.
3. Platform: add a migration that inserts the game into `games` (slug, name, seat limits, and what its per-seat `score` means), so match results are accepted. No other platform or backoffice change is needed ([match-schema.md](architecture/match-schema.md)).
4. Move log: every match must send its full move log with the result ([match-log.md](architecture/match-log.md)). Derive the events in the game's `match.ts`, list them in its `rules.md`, and optionally add a backoffice renderer in `apps/backoffice/src/lib/games/<slug>.ts` (register it in `lib/replay.ts`); without one the backoffice shows the raw events.
5. Docs: add `docs/games/<slug>/rules.md` (and `design.md` if the game has its own UI reasoning), and list it in the README.
