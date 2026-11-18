// Round history (docs/architecture/fairness.md): the room cuts each round out of the move log when it closes and
// sends it to the platform (POST /v1/matches/:id/rounds), so a match shows its rounds, seeds revealed, while it
// is still played.
import { clientSeedOf } from 'contracts/fairness/fairness'
import type { LogEntry, LogEvent, MatchInfo, RoundReport, RoundResult } from '../domain/match'

/** The fairness entries (fairness.ts): kept out of the events a game summarises. */
const FAIRNESS_TYPES = ['fairness', 'shuffle', 'reveal']

const roundOfDeal = (event: LogEntry) => (event.type === 'deal' ? Number(event.data?.round) : null)

/**
 * The rounds a batch of entries closes: a deal of round r closes round r - 1, and the end of the match closes
 * the round being played (`current`, null before the first deal).
 */
export function closedRounds(
  batch: LogEntry[],
  current: number | null,
  matchEnded: boolean,
): number[] {
  const closed = batch
    .map(roundOfDeal)
    .filter((round): round is number => round !== null && round > 1)
    .map((round) => round - 1)

  if (matchEnded && current !== null && !closed.includes(current)) {
    closed.push(current)
  }

  return closed
}

/**
 * Round `round` cut out of the match's log: its commitment and revealed seed, its shuffles (by their own round, as
 * the room logs them before the moves of the same commit), and the game's summary of the events from its deal up
 * to the next deal. Null when the log has no deal, commitment or reveal for it.
 */
export function roundReport(
  log: LogEvent[],
  round: number,
  match: MatchInfo,
  roundResult: RoundResult,
): RoundReport | null {
  const ofRound = (event: LogEvent, type: string) =>
    event.type === type && Number(event.data?.round) === round

  const dealAt = log.findIndex((event) => roundOfDeal(event) === round)
  const committed = log.find((event) => ofRound(event, 'fairness'))?.data
  const revealed = log.find((event) => ofRound(event, 'reveal'))?.data
  if (dealAt === -1 || !committed || !revealed) {
    return null
  }

  const nextDealAt = log.findIndex((event, index) => index > dealAt && roundOfDeal(event) !== null)
  const span = nextDealAt === -1 ? log.slice(dealAt) : log.slice(dealAt, nextDealAt)
  const events = span.filter((event) => !FAIRNESS_TYPES.includes(event.type))

  const shuffles = log
    .filter((event) => ofRound(event, 'shuffle'))
    .map((event) => {
      const nonce = Number(event.data?.nonce)
      const clientSeed = clientSeedOf(match.id, { round, nonce })
      const deck = (event.data?.deck as string[] | undefined) ?? []

      return { nonce, clientSeed, deck }
    })

  const matchStart = Date.parse(match.startedAt)
  const firstT = span.at(0)!.t
  const lastT = Math.max(...span.map((event) => event.t))

  return {
    roundId: String(committed.roundId),
    game: match.game,
    roomCode: match.roomCode,
    round,
    serverSeedHash: String(committed.serverSeedHash),
    serverSeed: String(revealed.serverSeed),
    shuffles,
    result: roundResult(events),
    events,
    startedAt: new Date(matchStart + firstT).toISOString(),
    endedAt: new Date(matchStart + lastT).toISOString(),
  }
}
