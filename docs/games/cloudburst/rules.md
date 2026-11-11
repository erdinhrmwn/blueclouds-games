# Cloudburst rules

> Proposal, not built yet. Working name "Cloudburst", slug `cloudburst`.

A race to empty your hand. Play a card that matches the sky on the pile, use weather cards to get in each other's way, and be the first with no cards left.

## Players and table

- 2–6 players, bots allowed. Same table as Bust 31: a dealer at the head, 6 fixed seats, turns go clockwise by seat number at the start.
- In the lobby you pick an empty seat ("Sit here"); the host puts a bot in a seat with its "+" button and starts the game.
- Closing the tab works like Bust 31: in the lobby you leave after 15 seconds (a refresh is fine); mid-game your seat is marked "away" and played for you until you come back.

## The deck (92 cards)

Four suits, each a kind of weather: **Sun**, **Rain**, **Wind** and **Storm**.

| Card | Per suit | Total | What it does |
|---|---|---|---|
| Number 1–8 | 2 of each | 64 | Nothing extra. |
| **Calm** | 2 | 8 | The next player misses their turn. |
| **Swirl** | 2 | 8 | Reverses the turn order. |
| **Gust** | 2 | 8 | You also hand one other card from your hand to the next player. |
| **Rainbow** | (no suit) | 4 | Fits on anything. You choose the suit the next player must follow. |

## A turn

The dealer deals 7 cards to each player and turns one card face up to start the pile (a Rainbow goes back into the deck; an action card turned up this way has no effect). Then, on your turn, you do one of two things:

1. **Play one card that fits** the top of the pile:
   - the **same suit** (for a Rainbow: the suit its player chose), or
   - a number **exactly one higher or one lower** (a 5 fits on a 4 or a 6, in any suit; there is no wrap from 8 to 1), or
   - the **same action** (Calm on Calm, Swirl on Swirl, Gust on Gust), or
   - a **Rainbow**, which fits on anything.
2. **Draw one card.** If it fits, you may play it right away; otherwise (or if you'd rather keep it) press **Pass**. You may draw even when you hold a card that fits.

A same number does **not** fit by itself (a 5 on a 5 needs the same suit). This "one step" rule is what makes Cloudburst its own game: you plan little runs up and down the numbers.

When the deck runs out, everything under the top card is shuffled into a new deck. If there is nothing left to draw, you can only play or pass.

## Action cards in detail

- **Calm**: the player after you is skipped. With 2 players you go again.
- **Swirl**: play now goes the other way. With 2 players it changes nothing (the other player is next either way).
- **Gust**: after the Gust lands, you pick one card from your hand and it goes face down to the next player in the (current) direction. If the Gust was your last card, you have won and nothing is given. Only you and the receiver see which card it was.
- **Rainbow**: pick Sun, Rain, Wind or Storm. The next player follows that suit (or plays another Rainbow). Nothing fits a Rainbow "by number".

## Winning

- The first player to empty their hand wins the match. One deal is one match.
- Everyone else is ranked by **cards left** (fewer is better). Players with the same number of cards share a place (e.g. 1st, 2nd, 2nd, 4th).
- Seats show how many cards each player holds. A seat with **1 card** left is marked for everyone; there is no "call" to make.

## Turn timer

- 20 seconds per turn (`TURN_MS`, same as Bust 31). The clock starts once the deal is done.
- When it runs out, the server moves for you using the bot strategy (play a fitting card, or draw, then play or pass). A Gust or Rainbow picked that way also gets its card or suit picked by the bot.
- The draw-then-play choice stays inside the same 20 seconds.

## Bots

Rule-based, like Bust 31 (`bots.ts`, pure functions, decide within 1.5–4 s on the same clock):

1. If the next player has 1 or 2 cards, play a **Calm**, then a **Gust**, then a **Swirl** if any fits (slow down the leader).
2. Otherwise play a fitting number or action card, preferring the suit the bot holds the most of (keeps its next turns easy).
3. Keep **Rainbow** for when nothing else fits. Its suit: the one the bot holds the most of.
4. **Gust** gives away the card the bot is least likely to use: never a Rainbow, otherwise a card of the suit it holds the fewest of.
5. Nothing fits: draw; play the drawn card if it fits, otherwise pass.

## How long a match takes

Simulated with a simpler version of these bots (2,000 games per row, 7 cards each):

| Players | Turns (average) | 95% of games within | Draws per game |
|---|---|---|---|
| 2 | 21 | 45 | 6 |
| 4 | 30 | 46 | 6 |
| 6 | 40 | 57 | 7 |

At a few seconds per move that is roughly 2–5 minutes per match. The deck never ran out in these runs, and no hand grew past 12 cards. For comparison, matching on the same number instead made games 10–20% longer, and allowing "same or one away" made them 10–15% shorter with almost no drawing (about 4 draws per game).

## Match report and move log

- **Report** (`POST /v1/matches`, same as Bust 31): placement as above. The report's per-seat number is `livesLeft` today, which only makes sense for Bust 31; the proposal is to rename it to a game-defined `score` (Bust 31: lives left, Cloudburst: cards left). Nothing is deployed, so this is one migration plus a rename in Bust 31's `match.ts`.
- **Move log** (once the [match log](../../architecture/match-log.md) design lands): events built by `logEvents(before, after)` in `match.ts`.

| Type | Seat | Data |
|---|---|---|
| `deal` | — | `hands` (seat → card ids), `deck` (top first), `start` (first pile card), `starter` (seat) |
| `play` | player | `card`, `suit` (chosen, Rainbow only), `gave` (card id, Gust only), `left` (cards in hand after), `by` |
| `draw` | player | `card` (id or null when the deck was empty), `by` |
| `pass` | player | `by` |
| `reshuffle` | — | `deck` (new order, top first) |
| `away` / `back` | player | — |
| `finished` | — | `winner` (seat), `left` (seat → cards left) |

`by` is `player`, `timeout`, `away` or `bot`, as in Bust 31. Card ids say what the card is (`sun-5-1` = Sun 5, copy 1; `rain-calm-0`; `rainbow-2`).

## Building it (what is reused)

The earlier plan was to extract shared parts once a second game exists; this is that point. Only things both games already do the same way get shared, with no generic game engine:

| Shared piece | Today in Bust 31 | Proposal |
|---|---|---|
| Seats (add, take seat, remove, free seats, next seat in a direction) | `rules.ts` | Move to `apps/server/src/games/shared/seats.ts`, pure functions over `{ id, seat, bot }` players. |
| Turn clock, bot think time, away autoplay, leave after 15 s | `actor.ts` (`scheduleTurn`, `dropIfGone`) | Move to `shared/turns.ts`; each actor passes its own "move for this player" function. |
| Match result outbox and retry (`match_reports`, `sendReports`) | `actor.ts` | Move to `shared/reports.ts`. |
| Room list | `directory.ts` (actor `bust31Rooms`) | One directory actor for every game, keyed by slug (`rooms.getOrCreate([slug])`). |
| Room tokens and room list on the web server | `apps/web/src/lib/server/rivet.ts` (hard-codes `bust31Room`) | Pick the room actor by game slug, so `/api/rooms` and `/api/rooms/:code/token` take the game. |
| Web: lobby seats, connection wrapper, room list, dealer, felt, seat | `lib/games/bust-31/` and `lib/components/` | Move the game-agnostic parts to `lib/components/` and `lib/rooms/`; Bust 31 keeps its gauge, stamp and cards. |

New for Cloudburst: `apps/server/src/games/cloudburst/{rules,bots,match,schema,actor}.ts` (actor `cloudburstRoom`, one action `play({ cardId, suit?, giveId? })` plus `draw` and `pass`), rule tests in `rules.test.ts`, the web components in `lib/games/cloudburst/`, a catalog entry, and `cloudburst` in the platform's `GAMES` list.

Suggested order (one commit each): 1) extract the shared server parts with Bust 31 tests still green, 2) Cloudburst rules + bots + tests, 3) actor, 4) web table, 5) platform `score` rename and game entry.

UI design reasoning: [design.md](design.md).
