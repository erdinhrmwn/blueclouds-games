import { must } from 'contracts/must'
import {
  fairnessText,
  type LogEvent,
  type MatchLog,
  type ReplaySeat,
  type SeatState,
  type Step,
  type TableState,
} from '../replay.ts'

// Keep in step with apps/server/src/games/bust-31/rules.ts (rules version 2; version 1 logs hold no s, t or d cards).
const LIMIT = 31
const START_LIVES = 3
const MINUS_VALUE = 5
const TEN_TOTAL = 10
const DOUBLE_PLAYS = 2

interface ReplayCard {
  value: number
  label: string
  effect: 'none' | 'reverse' | 'swap' | 'ten' | 'double'
}

/** Who made a play or bust: the player, or the server for them. */
type MoveBy = 'player' | 'bot' | 'timeout' | 'away'

interface DealData {
  round: number
  starter: number
  /** Cards dealt, by seat; seats already out get none. */
  hands: Record<number, string[]>
  deck: string[]
}

interface PlayData {
  card: string
  total: number
  drew: string | null
  /** Swap: the seat that traded hands with the player. */
  swapped?: number
  by: MoveBy
}

interface BustData {
  card: string
  total: number
  lives: number
  eliminated: boolean
  by: MoveBy
}

interface KickedData {
  by: 'host' | 'admin'
  reason?: string
}

/** The Bust 31 entries a log holds and their data, as apps/server/src/games/bust-31/match.ts writes them. */
type Bust31Entry =
  | { type: 'deal'; data: DealData }
  | { type: 'reshuffle'; data: { deck: string[] } }
  | { type: 'play'; data: PlayData }
  | { type: 'bust'; data: BustData }
  | { type: 'away' | 'back'; data: undefined }
  | { type: 'finished'; data: { winner: number } }
  | { type: 'kicked'; data: KickedData }
  | { type: 'terminated'; data: { reason: string } }

/**
 * Card ids say what the card is: n7-2 is a 7, z-0 a zero, m-1 a minus five, r-3 a reverse,
 * s-0 a Swap, t-1 a Ten and d-0 a Double.
 */
function cardOf(id: string): ReplayCard {
  const kind = id[0]
  if (kind === 'n') {
    const value = Number(id.slice(1, id.indexOf('-')))
    return { value, label: String(value), effect: 'none' }
  }

  if (kind === 'm') {
    return { value: -MINUS_VALUE, label: `-${MINUS_VALUE}`, effect: 'none' }
  }

  if (kind === 'r') {
    return { value: 0, label: 'Reverse', effect: 'reverse' }
  }

  if (kind === 's') {
    return { value: 0, label: 'Swap', effect: 'swap' }
  }

  if (kind === 't') {
    return { value: 0, label: 'Ten', effect: 'ten' }
  }

  if (kind === 'd') {
    return { value: 0, label: 'Double', effect: 'double' }
  }

  return { value: 0, label: '0', effect: 'none' }
}

const BY: Partial<Record<MoveBy, string>> = {
  timeout: ' (time ran out, played for them)',
  away: ' (away, played for them)',
}

/**
 * Folds a Bust 31 log into one table state per event. The server's own numbers in the log
 * (totals, lives, cards drawn) are compared with the replay; any difference is flagged.
 */
export function replayBust31(log: MatchLog, seats: ReplaySeat[]): Step[] {
  const order = [...seats].sort((a, b) => a.seat - b.seat).map((seat) => seat.seat)
  const name = (seat: number | undefined) =>
    seats.find((entry) => entry.seat === seat)?.name ?? `Seat ${(seat ?? 0) + 1}`

  const table = new Map<number, { lives: number; hand: string[]; away: boolean }>(
    order.map((seat) => [seat, { lives: START_LIVES, hand: [], away: false }]),
  )

  let round = 0
  let total = 0
  let direction = 1
  let playsLeft = 1
  let turn: number | null = null
  let deck: string[] = []
  let pile: string[] = []

  const stateOf = (seat: number) => must(table.get(seat), `seat ${seat}`)

  const nextAlive = (from: number) => {
    const start = order.indexOf(from)
    const count = order.length

    for (let step = 1; step <= count; step++) {
      // Wraps around both ways: ((x % n) + n) % n is never negative.
      const index = (((start + step * direction) % count) + count) % count
      const seat = must(order[index], 'seat')
      if (stateOf(seat).lives > 0) {
        return seat
      }
    }

    return from
  }

  const snapshot = (): TableState => ({
    round,
    total,
    limit: LIMIT,
    clockwise: direction === 1,
    turnSeat: turn,
    pileTop: pile.length ? cardOf(must(pile.at(-1), 'pile top')).label : null,
    deckCount: deck.length,
    seats: order.map((seat): SeatState => {
      const state = stateOf(seat)
      const hand = state.hand.map((id) => cardOf(id).label)

      return { seat, lives: state.lives, hand, away: state.away }
    }),
  })

  return log.events.map((event: LogEvent): Step => {
    // The server writes each entry's data for its type, so the type says what the data holds.
    const entry = event as Bust31Entry
    const who = name(event.seat)
    const player = event.seat === undefined ? undefined : table.get(event.seat)

    const mismatches: string[] = []
    const expect = (what: string, logged: unknown, replayed: unknown) => {
      if (logged !== replayed) {
        mismatches.push(`${what}: logged ${String(logged)}, replay ${String(replayed)}`)
      }
    }

    let text: string

    switch (entry.type) {
      case 'deal': {
        round = entry.data.round
        deck = [...entry.data.deck]
        pile = []
        total = 0
        direction = 1
        playsLeft = 1
        turn = entry.data.starter

        for (const [seat, state] of table) {
          state.hand = [...(entry.data.hands[seat] ?? [])]
        }

        text = `Round ${round} dealt. ${name(entry.data.starter)} starts.`
        break
      }

      case 'reshuffle':
        deck = [...entry.data.deck]
        pile = []
        text = 'The deck ran out. The pile was shuffled into a new deck.'
        break
      case 'play':
      case 'bust': {
        const card = cardOf(entry.data.card)
        const playedBy = BY[entry.data.by] ?? ''

        if (!player?.hand.includes(entry.data.card)) {
          mismatches.push(`${entry.data.card} was not in ${who}'s hand`)
        }

        if (player) {
          player.hand = player.hand.filter((id) => id !== entry.data.card)
        }

        expect('Turn', event.seat, turn)
        total = card.effect === 'ten' ? TEN_TOTAL : Math.max(0, total + card.value)
        expect('Total', entry.data.total, total)
        pile.push(entry.data.card)

        if (entry.type === 'play') {
          const drew = deck.shift() ?? null
          expect('Card drawn', entry.data.drew, drew)

          if (player && drew) {
            player.hand.push(drew)
          }

          if (card.effect === 'reverse') {
            direction = -direction
          }

          const next = nextAlive(must(event.seat, 'seat of the play'))
          let swapText = ''
          if (card.effect === 'swap') {
            expect('Swapped with', entry.data.swapped, next)

            const other = table.get(next)
            if (player && other) {
              ;[player.hand, other.hand] = [other.hand, player.hand]
            }

            swapText = ` Swapped hands with ${name(next)}.`
          }

          // A Double gives the next seat two plays; a seat that owes another play keeps the turn.
          if (card.effect === 'double') {
            turn = next
            playsLeft = DOUBLE_PLAYS
          } else if (playsLeft > 1) {
            playsLeft -= 1
          } else {
            turn = next
          }

          text = `${who} played ${card.label}. Total ${total}.${swapText}${playedBy}`
          break
        }

        if (player) {
          player.lives = Math.max(0, player.lives - 1)
        }

        expect('Lives', entry.data.lives, player?.lives)
        turn = null

        const lifeWord = player?.lives === 1 ? 'life' : 'lives'
        const left = entry.data.eliminated ? 'and is out' : `${player?.lives} ${lifeWord} left`
        text = `${who} went over ${LIMIT} with ${card.label}. Total ${total}, ${left}.${playedBy}`
        break
      }

      case 'away':
        if (player) {
          player.away = true
        }

        text = `${who} closed the game. Their turns are played for them.`
        break
      case 'back':
        if (player) {
          player.away = false
        }

        text = `${who} came back.`
        break
      case 'finished':
        turn = null
        text = `${name(entry.data.winner)} wins.`
        break
      case 'kicked': {
        const by = entry.data.by === 'host' ? 'the host' : 'an admin'
        const reason = entry.data.reason ? ` Reason: ${entry.data.reason}` : ''
        text = `${who} was kicked by ${by}. Their turns are played for them.${reason}`
        break
      }

      case 'terminated':
        turn = null
        text = `An admin terminated the table. Reason: ${entry.data.reason}`
        break
      default:
        text = fairnessText(event) ?? `${event.type} ${JSON.stringify(event.data ?? {})}`
    }

    return {
      event,
      text,
      state: snapshot(),
      ...(mismatches.length ? { mismatch: mismatches.join('; ') } : {}),
    }
  })
}
