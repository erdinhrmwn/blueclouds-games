# Bust 31 design

**Design read:** a turn-based browser card game for friends playing together (desktop and phone). The visual language is a physical card table in a dim room. Dials: ENERGY 2, RHYTHM 2, MOTION 2.

This direction is still a prototype proposal. There is no BlueClouds brand guide yet, so replace anything that clashes with the brand.

## Decisions and reasons

| Decision | Reason |
|---|---|
| Main screen = oval table with seats around it | It's turn-based: players must see at once who sits where and whose turn it is. Your seat is always at the bottom; turns go clockwise. |
| Fixed dark theme (no toggle) | A felt table in a dim room is the game's identity. The cream cards are the brightest element, so the eye goes straight to them. |
| Palette: felt green, wood, cream paper + brass accent | The three core colours come from physical objects on a card table. Brass is used for one thing only: "your turn" / the primary action. |
| Brick red (ember) | Not decoration: only for lives and a total close to 31 (danger). |
| Fraunces for headings and card numbers | A heavy serif with an old-print feel, like the numbers on playing cards. IBM Plex Sans for UI text because it stays clear at small sizes. |
| Monospace only for the table code | The code is read aloud to friends, so characters must be easy to tell apart. Not used for decorative labels. |
| One focal point per screen | Lobby: the table code. Game: the total meter. Finished: the winner's name. |
| Motion (MOTION 2) | Every animation reports something happening at the table: a card flies from the player's seat to the pile (who played), the total "pops" (the total changed), the table shakes + a red "Bust" stamp (someone lost a life), cards scatter + the winner's name rises (the table is done). Hover lifts a card (clickable), and the seat whose turn it is pulses. All off under `prefers-reduced-motion`. |
| Turn timer | A ring on the seat whose turn it is, so everyone sees who they are waiting for. It turns red in the last 5 seconds. The server owns the deadline; the browser only counts down. |
| Shadows | Only for things that really sit "on" the table: cards and the table rim. |

## Deliberately not used

Blue/purple gradients, emoji as icons, wide-tracked uppercase labels, pill badges, numbered feature cards, and made-up stats or testimonials.
