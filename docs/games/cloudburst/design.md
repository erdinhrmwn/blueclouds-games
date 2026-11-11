# Cloudburst design

> Proposal, not built yet.

**Design read:** the same dim card room as Bust 31, so the two games feel like tables in one club, but the felt now holds a pile, a deck and a big hand of cards instead of a running total. Desktop and phone, friends playing together. Dials: ENERGY 3, RHYTHM 3, MOTION 2. Turns are quicker than in Bust 31 (most moves are one tap), so the table should read at a glance.

There is still no BlueClouds brand guide; replace anything that clashes with it.

## Layout

- **Table:** Bust 31's oval felt, dealer at the head, 6 fixed seats, everyone sees the same seating. Shared components (`Felt`, `Seat`, `Dealer`, lobby seats) are reused as is.
- **Centre:** the deck (face down, with its count) on the left and the pile on the right. The pile's top card is the focal point of the game screen. Around the pile sits a thin ring in the **current suit's colour with its glyph and name** ("Rain"), so after a Rainbow everyone sees what to follow. A small arrow under the pile shows the turn direction.
- **Seats:** name, card count as a number on a small face-down stack, turn ring with the countdown. At 1 card the count turns ember and reads "1 card".
- **Points:** under each name, a cloud meter of 10 small segments filling with the player's points, plus the number ("6 of 10"). It replaces Bust 31's life dots in the same spot of the shared `Seat`. The segments are slate, and turn ember from 8 points (close to bursting).
- **Round counter** next to the dealer: "Round 3".
- **Your hand:** a fan along the bottom, sorted by suit then number. Cards that fit are raised and fully bright; cards that don't are lowered and dimmed, and say so to screen readers ("Wind 3, does not fit"). The hand is disabled when it isn't your turn.
- **Turn bar** under the hand on your turn: "Your turn" (brass), **Draw** button, and after a draw, **Pass**.

| Screen | Focal point |
|---|---|
| Lobby | The table code (same as Bust 31) |
| Game | The top card of the pile and its suit ring |
| Round end | The round summary: who went out, and each seat's "+N" |
| Finished | The winner's name, with the final points of every seat |

## Cards

- Cream paper face like Bust 31, so cards stay the brightest thing on the table.
- Each suit has a **colour and its own simple glyph** (drawn as SVG, no emoji), in the card corner and big in the middle, so suits are never told apart by colour alone:

| Suit | Colour | Glyph | Contrast on the card |
|---|---|---|---|
| Sun | ochre `#8c5400` | disc with short rays | 5.2:1 |
| Rain | slate blue `#2c5f8a` | drop | 5.6:1 |
| Wind | pine `#2f6e4f` | three swept lines | 5.1:1 |
| Storm | plum `#6a3d78` | bolt | 6.9:1 |

- Numbers in Fraunces, as in Bust 31. Action cards show their word ("Calm", "Swirl", "Gust") under a larger glyph: a flat line for Calm, a looped arrow for Swirl, a pushed card shape for Gust.
- **Rainbow:** ink face with four thin bands in the four suit colours. Not a gradient: four flat stripes.
- Brass stays reserved for "your turn" and the primary button; ember for danger only (1 card left), as in Bust 31.

## Choices inside a turn

- **Rainbow:** tapping it opens a small picker over the hand with four large suit buttons (glyph + name, 44px or more). Esc or "Cancel" puts the card back.
- **Gust:** tapping it switches the hand to "Pick a card to give to Bot Rain". The Gust is shown lifted above the hand, the other cards become choices, and "Cancel" puts it back. Nothing is sent until the second pick, so the server gets one `play` with both cards.
- Both choices run on the same turn clock; the ring keeps counting.

## Motion (MOTION 2)

Every animation reports a table event, as in Bust 31. All of it is off under `prefers-reduced-motion`.

| Event | Animation |
|---|---|
| Deal | The dealer deals face-down cards round the table, then flips the first pile card. |
| Play | The card flies from the player's seat (or your hand) to the pile. |
| Draw | A face-down card flies from the deck to the seat; for you it flips into your hand. |
| Calm | The skipped seat greys out briefly with "Skipped". |
| Swirl | The direction arrow turns over. |
| Gust | A face-down card slides from the giver's seat to the receiver's seat. |
| Rainbow | The suit ring fades to the chosen suit. |
| Round end | The last card lands, the other hands fan open face up, and each hand's cards fly as drops into that seat's cloud meter while a "+N" counts up. Then the dealer collects and deals the next round. |
| Burst | The cloud that reached 10 shakes once and its meter flashes ember. |
| Win | The winner's name rises (Bust 31's `WinCascade`), with the final points table below it. |

## Between rounds

- A short summary over the felt for about 4 seconds: "Bot Rain went out", then every seat with "+N" and its new total, sorted by total. No button to press, so a table with bots never waits; the server holds the next deal for that time, like the deal pause in Bust 31.
- A tie round is announced as "Tie for fewest points: one more round".
- Finished: the summary stays, with the winner on top, and the host gets "Play again" as in Bust 31.

## Phones (360px wide)

- The seats shrink to name, card count and points as a number (the cloud meter is dropped below 400px), as in Bust 31.
- The hand overlaps cards but always shows at least 44px of each, so every card is a real tap target; past that it scrolls sideways (no card is ever hidden off screen without a scroll hint at the edge).
- The turn bar stays fixed above the bottom edge.

## Keyboard

Hand cards are buttons: Tab or the arrow keys move along the hand, Enter plays. `D` draws, `P` passes. The suit picker and the Gust pick are in the normal tab order and Esc cancels them. Focus returns to the hand after each move.

## Original on purpose

Shedding is an old, generic idea, but Cloudburst does not copy any commercial game: its own name, weather suits and art, the "one step up or down" matching rule, Gust (give a card instead of making someone draw), no draw-penalty cards, and no last-card call.

## Deliberately not used

Blue/purple gradients, emoji as icons, wide-tracked uppercase labels, pill badges, colour-only suit marks, and confetti.
