# Adding a game

1. Server: add `apps/server/src/games/<slug>/` with its actor and rules, and register the actor in `registry.ts`. Seats, the turn clock, leaving, the room list and the match result outbox come from `games/shared/`; the room reports to `roomList` under its slug.
2. Web: add `apps/web/src/lib/games/<slug>/` with a `Home` and `Room` component, add an entry to `catalog.ts`, and map the slug to its room actor in `lib/server/rivet.ts`.
3. Platform: add the slug and its seat limits to `apps/platform/src/games.ts` so match results are accepted.
4. Docs: add `docs/games/<slug>/rules.md` (and `design.md` if the game has its own UI reasoning), and list it in the README.
