// Layer 3, room: every change to a room ends in a commit (log it, save it, show it), and every match starts on
// the seeds the room committed to before it.

import type { PlayerId } from '../domain/ids'
import type {
  LogEntry,
  LogEvent,
  MatchEnd,
  MatchInfo,
  MatchReport,
  MatchState,
  RoundResult,
} from '../domain/match'
import type { RoomPorts } from '../domain/ports'
import type { GameTable, Rng } from '../domain/table'
import { fairRng, matchSeeds, newCommitment, seedsForRound } from '../rules/fair-rng'
import { matchEnd, revealOf, stamp, withoutKickedAway } from '../rules/match'
import { closedRounds, roundReport } from '../rules/rounds'
import { randomRng } from '../rules/table'
import { apply, playerOf } from './access'
import { type RoomCtx, roomCode } from './context'
import { reportToDirectory } from './listing'
import { savedRoom } from './state'

/** What a commit needs from the game being played. */
export interface CommitSteps<G extends GameTable, M extends MatchState> {
  slug: string
  /** Arms the turn clock when a new turn started. */
  scheduleTurn(): Promise<void>
  /** What changed between two states, for the move log. */
  logEvents(before: G, after: G, auto: boolean): LogEntry[]
  /** Updates the match record after each move (e.g. who was knocked out). */
  noteMove?(match: M, game: G): M
  /** The game's summary of a closed round, for the round history. */
  roundResult: RoundResult
  buildReport(
    match: M,
    game: G,
    roomCode: string,
    endedAt: string,
    log: LogEvent[],
    end: MatchEnd,
  ): MatchReport
  /** What everyone sees. */
  view(): unknown
  /** What one player sees of their own cards. */
  handOf(playerId: PlayerId): unknown
}

/**
 * After every change: arm the turn clock (`scheduleTurn`), log what changed, save room + log in one
 * transaction (so the log never skips or repeats a move), then push the view to everyone and each
 * hand to its owner. Each round the change closes goes to the round outbox. When the game just finished, or an
 * admin terminated the table mid-match, its result and full log go to the outbox. `auto` marks a move the
 * server made (bot, timeout or away player) for the move log; `extra` is logged before what the game's own diff
 * finds (a kick, a termination).
 */
export async function commitRoom<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  ports: RoomPorts,
  steps: CommitSteps<G, M>,
  auto = false,
  extra: LogEntry[] = [],
): Promise<void> {
  const vars = c.vars

  // A terminated table runs no clock: nothing moves there again.
  if (vars.terminated) {
    vars.timer = null
  } else {
    await steps.scheduleTurn()
  }

  const running = vars.match
  const end = running ? matchEnd(!!vars.terminated, vars.game.phase) : null
  const seeds = running?.seeds
  const moves = running
    ? withoutKickedAway(extra, steps.logEvents(vars.logged, vars.game, auto))
    : []

  // The rounds this change closes: a new deal closes the round before it, the end of the match its last one.
  // Each closed round's seed is revealed after its moves.
  const closing = seeds ? closedRounds(moves, seeds.current?.round ?? null, end !== null) : []
  const reveals = seeds ? closing.flatMap((round) => revealOf(seeds, round)) : []

  const entries = running ? [...extra, ...vars.fairLog, ...moves, ...reveals] : []
  vars.logged = vars.game
  vars.fairLog = []

  let match: M | null = null
  let events: LogEvent[] = []
  if (running) {
    const noted = steps.noteMove ? steps.noteMove(running, vars.game) : running
    const stamped = stamp(noted, entries, Date.now())
    match = stamped.match
    events = stamped.events
  }

  vars.match = end ? null : match
  if (end && match) {
    vars.lastMatchId = match.id
  }

  const code = roomCode(c)
  const game = vars.game
  const saved = savedRoom(vars)

  await ports.store.transaction(async (tx) => {
    if (!match) {
      await tx.saveRoom(saved)
      return
    }

    await tx.appendEvents(match.id, events)

    let log: LogEvent[] = []
    if (end || closing.length > 0) {
      log = await tx.matchLog(match.id)
    }

    const info: MatchInfo = {
      id: match.id,
      game: steps.slug,
      roomCode: code,
      startedAt: match.startedAt,
    }
    for (const round of closing) {
      const closed = roundReport(log, round, info, steps.roundResult)
      if (closed) {
        await tx.queueRound(match.id, closed)
      }
    }

    if (end) {
      const endedAt = new Date().toISOString()
      const report = steps.buildReport(match, game, code, endedAt, log, end)

      await tx.queueMatch(report)
      await tx.clearMatchLog(match.id)
    }

    await tx.saveRoom(saved)
  })

  c.broadcast('view', steps.view())
  for (const conn of c.conns.values()) {
    const playerId = playerOf(c, conn)
    if (playerId) {
      conn.send('hand', steps.handOf(playerId))
    }
  }

  // After the players got their update, so the list never slows a move.
  await reportToDirectory(c, ports, steps.slug)

  if (end || closing.length > 0) {
    await c.schedule.after(0, 'sendReports')
  }
}

/**
 * Starts a match on what the room committed to before it: the match id and its first round's seed. `start`
 * deals with the room's fair rng; `extra` fills the game's own match fields. If `start` refuses (a rule),
 * nothing changed. The next match gets a new commitment.
 */
export function beginMatch<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  extra: Omit<M, keyof MatchState>,
  start: (rng: Rng) => G,
): void {
  const vars = c.vars
  const next = vars.next

  // `extra` holds exactly the fields M adds to MatchState.
  const match = {
    ...extra,
    id: next.matchId,
    startedAt: new Date().toISOString(),
    seq: 0,
    seeds: matchSeeds(next),
  } as M

  vars.match = match
  vars.fairLog = []

  try {
    vars.game = withRng(c, start)
  } catch (err) {
    vars.match = null
    vars.fairLog = []
    throw err
  }

  vars.next = newCommitment()
}

/**
 * Runs a move with the room's rng, as `apply` does. A move the rules refuse may have shuffled first: its
 * shuffles and log entries are taken back, so the log only ever holds shuffles the game kept.
 */
export function withRng<G extends GameTable, M extends MatchState, T>(
  c: RoomCtx<G, M>,
  move: (rng: Rng) => T,
): T {
  const vars = c.vars
  const match = vars.match
  const pending = vars.fairLog.length

  try {
    return apply(() => move(roomRng(c)))
  } catch (err) {
    vars.match = match
    vars.fairLog = vars.fairLog.slice(0, pending)
    throw err
  }
}

/**
 * The rng a room deals with: the running match's seeds. The first shuffle of a round starts it on the committed
 * seed and logs that commitment (`fairness`); every shuffle is kept as the last one (for the next nonce) and
 * logged. A match started before provably fair shuffles keeps a plain random one.
 */
function roomRng<G extends GameTable, M extends MatchState>(c: RoomCtx<G, M>): Rng {
  const vars = c.vars
  const startSeeds = vars.match?.seeds
  if (!vars.match || !startSeeds) {
    return randomRng()
  }

  let match: M = vars.match

  const seedsFor = (round: number) => {
    const { seeds, started } = seedsForRound(match.seeds ?? startSeeds, round)
    if (!started || !seeds.current) {
      return seeds
    }

    const { roundId, serverSeedHash } = seeds.current
    match = { ...match, seeds }
    vars.match = match
    vars.fairLog.push({ type: 'fairness', data: { round, roundId, serverSeedHash } })

    return seeds
  }

  return fairRng(seedsFor, (record) => {
    const seeds = match.seeds ?? startSeeds
    const last = { round: record.round, nonce: record.nonce }

    match = { ...match, seeds: { ...seeds, last } }
    vars.match = match
    vars.fairLog.push({ type: 'shuffle', data: { ...record } })
  })
}
