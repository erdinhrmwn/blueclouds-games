import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { checkMatch, proofsFromLog } from 'contracts/fairness/fairness'
import { chooseBotCard } from '../../games/bust-31/bots'
import type { Game, MatchState } from '../../games/bust-31/domain'
import * as match from '../../games/bust-31/match'
import * as rules from '../../games/bust-31/rules'
import { migrateRoom, type SqlDatabase, sqliteRoomStore } from '../adapters/room-store'
import { RuleError } from '../domain/table'
import { fairnessView } from '../rules/views'
import { beginMatch, commitRoom, withRng } from './commit'
import type { RoomCtx } from './context'
import { fakeLists, fakePlatform } from './fakes'
import { roomVars } from './state'

// This test is about what the room deals, logs and reports, through the real SQLite store.

/** bun:sqlite in memory, shaped like rivetkit's SQLite client. */
function memoryDatabase(): SqlDatabase {
  const sqlite = new Database(':memory:')
  const database: SqlDatabase = {
    execute: async <Row extends Record<string, unknown>>(sql: string, ...args: unknown[]) =>
      sqlite.query(sql).all(...(args as (string | number)[])) as Row[],
    transaction: async (work) => {
      sqlite.run('BEGIN')
      const result = await work(database)
      sqlite.run('COMMIT')

      return result
    },
  }

  return database
}

/** Just enough of an actor context for commitRoom: no connections, an open private table. */
function fakeRoom() {
  const db = memoryDatabase()

  let game = rules.createGame()
  game = rules.addPlayer(game, 'ann', 'Ann', false, 0)
  game = rules.addPlayer(game, 'bot-1', 'Bot Rain', true, 2)
  game = rules.addPlayer(game, 'bot-2', 'Bot Wind', true, 4)

  const c: RoomCtx<Game, MatchState> = {
    vars: { ...roomVars<Game, MatchState>(game), tournament: null, listed: false },
    key: ['ROOM42'],
    conns: new Map(),
    broadcast: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    schedule: { after: async () => {}, at: async () => {} },
  }

  return { c, db }
}

const commit = (c: RoomCtx<Game, MatchState>, db: SqlDatabase, auto = false) =>
  commitRoom(
    c,
    { platform: fakePlatform(), store: sqliteRoomStore(db), lists: fakeLists() },
    {
      slug: 'bust-31',
      scheduleTurn: async () => {},
      logEvents: match.logEvents,
      noteMove: match.noteMove,
      roundResult: match.roundResult,
      buildReport: match.buildReport,
      view: () => null,
      handOf: () => null,
    },
    auto,
  )

test('each round deals from the seed committed before it, and is reported with that seed revealed', async () => {
  const { c, db } = fakeRoom()
  await migrateRoom(db)

  const committed = structuredClone(c.vars.next)
  // The lobby shows the hash round 1 of the next match is locked to, before anyone is dealt a card.
  expect(fairnessView(c.vars)).toEqual({
    matchId: null,
    lastMatchId: null,
    round: 1,
    serverSeedHash: committed.firstRound.serverSeedHash,
    clientSeed: null,
    nextServerSeedHash: null,
  })

  beginMatch(c, { out: [] }, (rng) => rules.startGame(c.vars.game, 'ann', rng))
  await commit(c, db)
  expect(c.vars.next.matchId).not.toBe(committed.matchId)

  const playing = fairnessView(c.vars)!
  expect(playing).toMatchObject({
    matchId: committed.matchId,
    round: 1,
    serverSeedHash: committed.firstRound.serverSeedHash,
    clientSeed: `${committed.matchId}:1:0`,
  })

  // Round 2 is dealt from the seed whose hash the table showed during round 1.
  const round2Hash = playing.nextServerSeedHash
  let seenRound2 = false

  while (c.vars.game.phase === 'playing') {
    const player = c.vars.game.players[c.vars.game.turn]!
    const card = chooseBotCard(player.hand, c.vars.game.total)!
    c.vars.game = withRng(c, (rng) => rules.playCard(c.vars.game, player.id, card.id, rng))
    await commit(c, db, true)

    const view = fairnessView(c.vars)
    if (view?.round === 2) {
      seenRound2 = true
      expect(view.serverSeedHash).toBe(round2Hash!)
    }
  }

  expect(seenRound2).toBe(true)

  const [row] = await db.execute('SELECT body FROM match_reports')
  const report = JSON.parse(String(row!.body))

  expect(report.matchId).toBe(committed.matchId)
  expect(report).not.toHaveProperty('fairness')

  const proofs = proofsFromLog(report.matchId, report.log.events)
  const deals = report.log.events.filter((event: { type: string }) => event.type === 'deal')
  expect(proofs.length).toBe(deals.length)
  expect(fairnessView(c.vars)!.lastMatchId).toBe(committed.matchId)
  expect(proofs.at(0)!.serverSeed).toBe(committed.firstRound.serverSeed)
  expect(await checkMatch(proofs)).toMatchObject({ ok: true })

  // Every round went to the round outbox once, in order, with its seed and every shuffle's client seed.
  const roundRows = await db.execute('SELECT round, body FROM round_reports ORDER BY round')
  const rounds = roundRows.map((roundRow) => JSON.parse(String(roundRow.body)))

  expect(rounds.map((round) => round.round)).toEqual(proofs.map((proof) => proof.round))
  expect(rounds.at(0)).toMatchObject({
    roundId: committed.firstRound.roundId,
    game: 'bust-31',
    roomCode: 'ROOM42',
    serverSeed: committed.firstRound.serverSeed,
    serverSeedHash: committed.firstRound.serverSeedHash,
  })
  expect(rounds.at(0).shuffles.at(0).clientSeed).toBe(`${committed.matchId}:1:0`)
  expect(rounds.every((round) => 'seat' in round.result)).toBe(true)
})

test('a move the rules refuse takes back its shuffle', () => {
  const { c } = fakeRoom()
  beginMatch(c, { out: [] }, (rng) => rules.startGame(c.vars.game, 'ann', rng))
  const before = { seeds: c.vars.match!.seeds, pending: c.vars.fairLog.length }

  // A refused move that would have started round 2 keeps round 2's committed seed for the real one.
  expect(() =>
    withRng(c, (rng) => {
      rng.shuffle([{ id: 'a' }, { id: 'b' }], 2)
      throw new RuleError('nope')
    }),
  ).toThrow('nope')

  expect(c.vars.match!.seeds).toEqual(before.seeds)
  expect(c.vars.fairLog.length).toBe(before.pending)
})

test('a start the rules refuse leaves no match and keeps the commitment', () => {
  const { c } = fakeRoom()
  const committed = c.vars.next

  expect(() =>
    beginMatch(c, { out: [] }, (rng) => rules.startGame(c.vars.game, 'bot-1', rng)),
  ).toThrow()
  expect(c.vars.match).toBeNull()
  expect(c.vars.next).toBe(committed)
})
