# Provably fair shuffles

Status: **built** for Bust 31 and Cloudburst (room, platform, backoffice, web). Decided with Erdin on 2026-11-13: HMAC-SHA256, the server seed only (players have no seed they can set), and every shuffle has its own client seed `<matchId>:<round>:<nonce>`, so the cards never depend on which player sits where.

Every deck a room deals comes from a seed the room locked in before the match. Players see its hash before the first card, the seed is revealed when the match ends, and anyone can then recompute every shuffle and compare it with what was dealt.

## Seeds

| Seed | What it is | When it is known |
|---|---|---|
| Server seed | 32 random bytes, as 64 lowercase hex characters | Made with the commitment for the next match; revealed when that match ends |
| Server seed hash | `sha256(serverSeed)`, hex. The seed is hashed as its 64-character text | Shown at the table from the lobby on, before anyone starts |
| Match id | The match's UUIDv7, made together with the server seed | Shown with the hash |
| Client seed | One per shuffle: `<matchId>:<round>:<nonce>`. Example: `0192f…:2:1` | Known when the shuffle happens; every part of it is in the log |

The room makes the next commitment (match id + server seed) as soon as a match starts, so the next deal is locked before anyone sits down for it.

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
| `fairness` | `serverSeedHash` | First event of the match |
| `shuffle` | `round`, `nonce`, `deck` (card ids, top first) | Before the `deal` or `reshuffle` it produced |
| `reveal` | `serverSeed` | Last event of the match (after `finished` or `terminated`) |

The report (`POST /v1/matches`) also carries `fairness: { serverSeed, serverSeedHash }`. The platform refuses a report whose seed misses its hash, or whose log does not hold the same commitment and reveal. It stores both in `matches` (migrations 010 and 014). Matches played before have none.

A check walks the shuffles in log order: a round never goes back, and in each round the nonces count 0, 1, 2…

## Checking

- **Players:** the table's "Fair play" panel shows the hash before and during a match, the revealed seed after, and "Verify last match", which recomputes every shuffle of the last match in the browser (Web Crypto). The room hands out the last match's shuffles on request (`fairnessProof`).
- **Backoffice:** a match's page checks every shuffle in its log against the stored seeds and says "Verified" or which shuffles do not match. The replay lists the fairness events.
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

- `apps/server/src/games/shared/fairness.ts`: the algorithm and `checkFairness`, Web Crypto only (room tests, backoffice, browser).
- `apps/server/src/games/shared/fair-rng.ts`: the room's synchronous side (Node `crypto`): new commitments and the shuffler the rules use.
- `apps/server/src/games/shared/room.ts`: `beginMatch`, `withRng`, the fairness entries in `commitRoom`, `fairnessView`, `lastProof`.
- A pinned test in `fairness.test.ts` fails if the algorithm ever changes, because that would break the check of every match already played.

Bot think times still use `Math.random()`: they never change what is dealt.
