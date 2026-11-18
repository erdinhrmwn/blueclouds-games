// Layer 3, room: the outbox. Closed rounds and finished results wait in the room's store until the platform has
// them, retried with backoff; the platform ignores duplicates.

import type { MatchId } from '../domain/ids'
import type { PlatformPort, RoomStorePort } from '../domain/ports'
import type { RoomCtx } from './context'

/** Wait before each retry of an unsent report; the last one repeats forever. */
const REPORT_RETRY_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000]
const FIRST_RETRY_MS = 10_000

interface ReportPorts {
  platform: PlatformPort
  store: RoomStorePort
}

/** The shortest wait any failed report asked for; null while nothing failed. */
interface Retry {
  after(attempts: number): void
  readonly inMs: number | null
}

function retryPlan(): Retry {
  let inMs: number | null = null

  return {
    after: (attempts) => {
      const step = Math.min(attempts, REPORT_RETRY_MS.length - 1)
      const wait = REPORT_RETRY_MS[step] ?? FIRST_RETRY_MS
      inMs = Math.min(inMs ?? wait, wait)
    },
    get inMs() {
      return inMs
    },
  }
}

/** onWake: a send may have been cut off by the actor stopping. */
export async function resumeReports(c: RoomCtx, store: RoomStorePort): Promise<void> {
  if (await store.hasQueuedReports()) {
    await c.schedule.after(FIRST_RETRY_MS, 'sendReports')
  }
}

/**
 * Body of the scheduled `sendReports` action: sends queued rounds, then queued results, retrying with backoff.
 * A match's rounds go in order, and its result waits until they are all sent.
 */
export async function sendReports(c: RoomCtx, ports: ReportPorts): Promise<void> {
  const retry = retryPlan()
  const waiting = await sendRounds(c, ports, retry)

  for (const queued of await ports.store.queuedMatches()) {
    if (waiting.has(queued.matchId)) {
      continue
    }

    const { result, detail } = await ports.platform.reportMatch(queued.report)

    if (result === 'retry') {
      await ports.store.matchFailed(queued.matchId)
      retry.after(queued.attempts)

      c.log.warn({
        msg: 'match report failed, will retry',
        matchId: queued.matchId,
        attempts: queued.attempts + 1,
        detail,
      })
      continue
    }

    if (result === 'rejected') {
      c.log.error({
        msg: 'match report rejected, dropped',
        matchId: queued.matchId,
        body: queued.body,
        detail,
      })
    }

    await ports.store.matchDone(queued.matchId)
  }

  if (retry.inMs !== null) {
    await c.schedule.after(retry.inMs, 'sendReports')
  }
}

/** Sends queued rounds in order. Returns the matches with a round still waiting: their later rounds wait too. */
async function sendRounds(c: RoomCtx, ports: ReportPorts, retry: Retry): Promise<Set<MatchId>> {
  const waiting = new Set<MatchId>()

  for (const queued of await ports.store.queuedRounds()) {
    if (waiting.has(queued.matchId)) {
      continue
    }

    const { result, detail } = await ports.platform.reportRound(queued.matchId, queued.report)
    const where = { matchId: queued.matchId, round: queued.round }

    if (result === 'retry') {
      await ports.store.roundFailed(queued.matchId, queued.round)
      retry.after(queued.attempts)
      waiting.add(queued.matchId)

      c.log.warn({
        msg: 'round report failed, will retry',
        ...where,
        attempts: queued.attempts + 1,
        detail,
      })
      continue
    }

    if (result === 'rejected') {
      c.log.error({ msg: 'round report rejected, dropped', ...where, body: queued.body, detail })
    }

    await ports.store.roundDone(queued.matchId, queued.round)
  }

  return waiting
}
