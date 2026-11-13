# Provably fair shuffles

Status: **built** for Bust 31 and Cloudburst (room, platform, backoffice, web). Decided with Erdin on 2026-11-13: HMAC-SHA256, the server seed only (players have no seed they can set), a server seed per round, and every shuffle has its own client seed `<matchId>:<round>:<nonce>`, so the cards never depend on which player sits where.

Every round is dealt from its own server seed, locked in before the round. Players see its hash before the round's first card, the seed is revealed when the round closes, and anyone can then recompute every shuffle of that round, while the match is still played.

## Seeds

| Seed | What it is | When it is known |
|---|---|---|
| Server seed | 32 random bytes, as 64 lowercase hex characters, one per round | Made a round ahead; revealed when its round closes |
| Server seed hash | `sha256(serverSeed)`, hex. The seed is hashed as its 64-character text | Shown at the table before its round is dealt |
| Round id | A UUIDv7, made together with the round's server seed | Logged with the hash when the round starts |
| Client seed | One per shuffle: `<matchId>:<round>:<nonce>`. Example: `0192f…:2:1` | Known when the shuffle happens; every part of it is in the log |

The room always holds two commitments: the round being played and the round after it. Both hashes are on the table (the Rounds dialog), so a round's hash is shown before the round is dealt, even when a move ends one round and deals the next at once. In the lobby the table shows round 1 of the next match. When a round starts, the next commitment becomes the current one and a new one is made.

The parts of a client seed:

- `round`: the round the shuffle is for. A new round's deal uses its number (the first deal is round 1); a reshuffle of the discard pile uses the round being played.
- `nonce`: the shuffle's count within its round, from 0. The round's deal is 0, each reshuffle in it counts up by one, so two shuffles of one round never share a client seed.

## A shuffle

1. Put the cards in id order (plain string order), so the result never depends on the order they lay in before.
2. Draw numbers: block `b` (0, 1, 2…) is `HMAC_SHA256(key = serverSeed, message = "<clientSeed>:<b>")`. One block gives 8 numbers and a deck needs one per card, so `b` only counts the blocks a deck needs (a 92-card deck uses 12). Each 32-byte block gives 8 numbers: bytes 4k to 4k+3 as a big-endian unsigned 32-bit integer, divided by 2^32.
3. Fisher-Yates from the end: for `i` from `n - 1` down to `1`, with the next number `f`, swap card `i` with card `floor(f * (i + 1))`.

The result is the deck, top first. A deck of `n` cards uses `n - 1` numbers.

## In the move log

| Type | Data | When |
|---|---|---|
| `fairness` | `round`, `roundId`, `serverSeedHash` | Before the first shuffle of each round |
| `shuffle` | `round`, `nonce`, `deck` (card ids, top first) | Before the `deal` or `reshuffle` it produced |
| `reveal` | `round`, `serverSeed` | When the round closes: after the next round's `deal`, or after `finished` / `terminated` |

## Round history

When a round closes, the room puts it in its round outbox and sends it to `POST /v1/matches/:matchId/rounds`: the round id and number, the game's summary of the round (`result`), its times, its server seed and hash, and every shuffle with its client seed and deck. The platform checks the seed against its hash, every client seed against `matchId:round:nonce` and the nonces 0, 1, 2…, and stores the round in `match_rounds` and each shuffle in `round_fairness` (migration 015). A match's rounds go in order, and its match report waits until they are sent. Matches keep no seed.

`GET /v1/matches/:matchId/rounds` gives any signed-in player a match's closed rounds, running or finished (matches are public).

A check of a match: its rounds run 1, 2, 3… with none skipped (so the room can't pick among rounds), every round's seed matches the hash shown before it, and every shuffle is what the seeds give.

## Checking

- **Players:** the shield button at the table opens the Rounds dialog: the hash and client seed of the round being played, the next round's hash, and every closed round, checked in the browser (Web Crypto). A round opens in its own dialog with its revealed seed, each shuffle's client seed and deck. Match history (`/history`) shows the same for finished matches.
- **Backoffice:** a match's page checks every closed round in its log against the seed it revealed and says "Verified" or which rounds and shuffles do not match. The replay lists the fairness events.
- **By hand:** the algorithm above in any language. A Python version:

```python
import hmac, hashlib, struct

def shuffle(server_seed, match_id, round, nonce, cards):
    client_seed = f"{match_id}:{round}:{nonce}"
    cards = sorted(cards)
    numbers, block = [], 0
    while len(numbers) < len(cards) - 1:
        message = f"{client_seed}:{block}".encode()
        digest = hmac.new(server_seed.encode(), message, hashlib.sha256).digest()
        numbers += [struct.unpack(">I", digest[i:i + 4])[0] / 2**32 for i in range(0, 32, 4)]
        block += 1
    for k, i in enumerate(range(len(cards) - 1, 0, -1)):
        j = int(numbers[k] * (i + 1))
        cards[i], cards[j] = cards[j], cards[i]
    return cards
```

## Code

- `apps/server/src/games/shared/fairness.ts`: the algorithm, `checkRound`, `checkMatch` and `proofsFromLog`, Web Crypto only (room tests, backoffice, browser).
- `apps/server/src/games/shared/fair-rng.ts`: the room's synchronous side (Node `crypto`): new round seeds, starting a round on its commitment (`seedsForRound`) and the shuffler the rules use.
- `apps/server/src/games/shared/rounds.ts`: which rounds a change closes and the round report cut out of the log.
- `apps/server/src/games/shared/room.ts`: `beginMatch`, `withRng`, the fairness entries and round outbox in `commitRoom`, `fairnessView`.
- `apps/platform/src/services/rounds.ts`: storing and reading rounds.
- A pinned test in `fairness.test.ts` fails if the algorithm ever changes, because that would break the check of every round already played.

Bot think times still use `Math.random()`: they never change what is dealt.
