# Bust 31 rules

- 2–6 players (bots allowed). Everyone has 3 lives and holds 3 cards.
- The table has 6 fixed seats around a dealer. In the lobby you can move to any empty seat ("Sit here"), and the host puts a bot in a seat with its "+" button. Turns go clockwise by seat number.
- The dealer deals every round; the first turn's clock starts once the deal is done.
- Closing the tab: in the lobby you leave the table after 15 seconds (a refresh is fine); mid-game your seat is marked "away" and played for you until you come back.
- Take turns playing 1 card. Its value is added to the shared total, then you draw a new card.
- Whoever pushes the total **over 31** loses a life, and a new round is dealt.
- Cards: numbers 1–9, **0** (skip), **−5** (lower the total, never below 0), **⇄** (reverse the turn order).
- The last player with lives left wins.
- Each human turn is limited to 20 seconds (`TURN_MS` in `rules.ts`). When it runs out, the server plays a card for you using the bot strategy. Bots get the same 20-second clock but decide within 1.5–4 seconds; every turn shows a countdown ring on that seat.

Every match records every move (deal, play, bust, reshuffle, away, back, finished) for replay and audit in the backoffice: event shapes in [match-log.md](../../architecture/match-log.md#bust-31-events).

Code: `apps/server/src/games/bust-31/` (rules, actor, bots) and `apps/web/src/lib/games/bust-31/` (UI). UI design reasoning: [design.md](design.md).
