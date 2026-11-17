import { describe, expect, test } from 'bun:test'
import { checkMatch, proofsFromLog } from 'contracts/fairness/fairness'
// Real games, logged by the room's own code (apps/server/scripts/match-fixtures.ts).
import fixtures from 'contracts/fixtures/bust-31-matches.json'
import { type MatchLog, replay } from './replay.ts'

interface PlayedGame {
  log: MatchLog
  seats: { seat: number; name: string }[]
  winner: string
  lives: number[]
}

const games = fixtures.matches as PlayedGame[]

describe('Bust 31 replay', () => {
  test('a whole game replays without a single mismatch and ends like the real one', () => {
    for (const { log, seats, winner, lives } of games) {
      const steps = replay('bust-31', log, seats)
      expect(steps.filter((step) => step.mismatch)).toEqual([])
      const last = steps.findLast((step) => step.event.type === 'finished')!
      expect(last.text).toBe(`${winner} wins.`)
      expect(steps.at(-1)!.text).toMatch(/^Round \d+ server seed revealed: /)
      expect(last.state!.seats.map((seat) => seat.lives)).toEqual(lives)
    }
  })

  test('every round of a played game checks out with its own revealed seed', async () => {
    for (const { log } of games) {
      const proofs = proofsFromLog(fixtures.matchId, log.events)
      const deals = log.events.filter((event) => event.type === 'deal')

      expect(proofs.length).toBe(deals.length)
      expect((await checkMatch(proofs)).ok).toBe(true)
    }
  })

  test('a tampered log is flagged', () => {
    const { log, seats } = games[0]!
    const i = log.events.findIndex((event) => event.type === 'play')
    const tampered = log.events.map((event, j) =>
      j === i ? { ...event, data: { ...event.data, total: 99 } } : event,
    )
    const steps = replay('bust-31', { ...log, events: tampered }, seats)
    expect(steps[i]!.mismatch).toContain('Total: logged 99')
  })

  test('describes timeouts and away players', () => {
    const seats = [
      { seat: 0, name: 'Ann' },
      { seat: 1, name: 'Bob' },
    ]
    const steps = replay(
      'bust-31',
      {
        logVersion: 1,
        events: [
          {
            seq: 0,
            t: 0,
            type: 'deal',
            data: { round: 1, starter: 0, hands: { 0: ['n7-0'], 1: ['m-0'] }, deck: ['r-1'] },
          },
          {
            seq: 1,
            t: 20_000,
            type: 'play',
            seat: 0,
            data: { card: 'n7-0', total: 7, drew: 'r-1', by: 'timeout' },
          },
          { seq: 2, t: 21_000, type: 'away', seat: 1 },
        ],
      },
      seats,
    )
    expect(steps.map((step) => step.text)).toEqual([
      'Round 1 dealt. Ann starts.',
      'Ann played 7. Total 7. (time ran out, played for them)',
      'Bob closed the game. Their turns are played for them.',
    ])
    expect(steps[1]!.state!.seats[0]!.hand).toEqual(['Reverse'])
    expect(steps[2]!.state!.seats[1]!.away).toBe(true)
  })
})

test('a game without a renderer shows its raw events', () => {
  const steps = replay(
    'chess',
    { logVersion: 1, events: [{ seq: 0, t: 0, type: 'move', seat: 1, data: { from: 'e2' } }] },
    [{ seat: 1, name: 'Bob' }],
  )
  expect(steps).toEqual([
    { event: expect.any(Object), text: 'Bob: move {"from":"e2"}', state: null },
  ])
})
