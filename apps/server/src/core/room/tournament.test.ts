import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'
import { NO_AVATAR } from 'contracts/avatars'
import type { Game, MatchState } from '../../games/bust-31/domain'
import { addPlayer, createGame } from '../../games/bust-31/rules'
import type { PlatformRoom, PlatformSeat } from '../domain/ports'
import { LATE_GRACE_MS } from '../rules/tournament'
import { requireOpenTable } from './access'
import type { RoomCtx } from './context'
import { fakePlatform } from './fakes'
import { roomVars } from './state'
import { loadTournament, seatFor, tournamentTick } from './tournament'

// The platform is a fake: these tests are about when a tournament table starts or gives up.
const marked: string[] = []
let seats: PlatformRoom | null = null
const platform = fakePlatform({
  fetchRoomSeats: async () => seats,
  markRoom: async (code, change) => {
    marked.push(`${code}:${change}`)

    return { ok: true }
  },
})

const START = Date.parse('2026-11-11T20:00:00Z')
const ANN = '01900000-0000-7000-8000-0000000000a1'
const BEN = '01900000-0000-7000-8000-0000000000b2'
const CY = '01900000-0000-7000-8000-0000000000c3'

const seat = (playerId: string, chair: number, botName?: string): PlatformSeat => ({
  playerId,
  seat: chair,
  bot: botName !== undefined,
  name: botName ?? '',
})

/** What the platform says about a room: Friday Cup's table by default, or an open table. */
function platformRoom(overrides: Partial<PlatformRoom> = {}): PlatformRoom {
  return {
    visibility: 'private',
    name: null,
    minPlayers: 2,
    startedAt: null,
    closedAt: null,
    tournament: {
      id: '01900000-0000-7000-8000-0000000000cc',
      name: 'Friday Cup',
      format: null,
      rounds: null,
      registered: null,
      round: 1,
      startsAt: new Date(START).toISOString(),
      cancelled: false,
    },
    seats: [seat(ANN, 0), seat(BEN, 1), seat(CY, 2)],
    ...overrides,
  }
}

function room(): RoomCtx<Game, MatchState> {
  return {
    vars: roomVars<Game, MatchState>(createGame()),
    key: ['CUP01'],
    conns: new Map(),
    broadcast: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    schedule: { after: async () => {}, at: async () => {} },
  }
}

/** Counts starts and commits instead of running a real match. */
function runner(c: RoomCtx<Game, MatchState>) {
  const calls = { started: 0, commits: 0 }
  return {
    calls,
    game: {
      start: () => {
        calls.started += 1
        c.vars.game = { ...c.vars.game, phase: 'playing', winnerId: null }
      },
      commit: async () => {
        calls.commits += 1
      },
      seatBot: (id: string, name: string, chair: number | null) => {
        c.vars.game = addPlayer(c.vars.game, id, name, true, chair ?? undefined)
      },
    },
  }
}

const sit = (c: RoomCtx<Game, MatchState>, ...ids: string[]) => {
  ids.forEach((id, index) => {
    c.vars.game = addPlayer(c.vars.game, id, `P${index}`, false, index)
  })
}

beforeEach(() => {
  marked.length = 0
  seats = platformRoom()
})
afterEach(() => setSystemTime())

test('only assigned players sit, each on their own seat; host controls are off', async () => {
  const c = room()
  expect(await seatFor(c, { id: BEN, name: 'Ben', vip: false, avatar: NO_AVATAR }, platform)).toBe(
    1,
  )
  expect(
    seatFor(
      c,
      {
        id: '01900000-0000-7000-8000-0000000000ff',
        name: 'Dee',
        vip: false,
        avatar: NO_AVATAR,
      },
      platform,
    ),
  ).rejects.toThrow('This table is for players of Friday Cup.')
  expect(() => requireOpenTable(c)).toThrow('A tournament table starts on its own.')
})

test('an open room lets anyone sit anywhere', async () => {
  seats = platformRoom({ tournament: null, seats: [] })
  const c = room()
  expect(
    await seatFor(c, { id: ANN, name: 'Ann', vip: false, avatar: NO_AVATAR }, platform),
  ).toBeUndefined()
  expect(() => requireOpenTable(c)).not.toThrow()
})

test('only a public open room goes on the room list', async () => {
  const open = platformRoom({ tournament: null, seats: [] })
  for (const [visibility, listed] of [
    ['public', true],
    ['private', false],
  ] as const) {
    seats = { ...open, visibility }
    const c = room()
    await loadTournament(c, platform)
    expect(c.vars.listed).toBe(listed)
  }

  seats = null // a room the platform doesn't know
  const c = room()
  await loadTournament(c, platform)
  expect(c.vars.listed).toBe(false)
})

test('with everyone in, nothing happens before the start time, then it starts', async () => {
  const c = room()
  await loadTournament(c, platform)
  sit(c, ANN, BEN, CY)
  const { calls, game } = runner(c)
  setSystemTime(START - 1000)
  await tournamentTick(c, platform, game)
  expect(calls.started).toBe(0)

  setSystemTime(START + 1000)
  await tournamentTick(c, platform, game)
  expect(calls.started).toBe(1)
  expect(marked).toEqual(['CUP01:start'])
})

test('waits for late players, then starts with those present', async () => {
  const c = room()
  await loadTournament(c, platform)
  sit(c, ANN, BEN)
  const { calls, game } = runner(c)
  setSystemTime(START + LATE_GRACE_MS - 1000)
  await tournamentTick(c, platform, game)
  expect(calls.started).toBe(0)
  setSystemTime(START + LATE_GRACE_MS)
  await tournamentTick(c, platform, game)
  expect(calls.started).toBe(1)
  expect(c.vars.game.players.map((player) => player.id)).toEqual([ANN, BEN])
})

test("closes the table when fewer than the game's minimum came", async () => {
  const c = room()
  await loadTournament(c, platform)
  sit(c, ANN)
  setSystemTime(START + LATE_GRACE_MS)
  const { calls, game } = runner(c)
  await tournamentTick(c, platform, game)
  expect(calls.started).toBe(0)
  expect(c.vars.tournament?.closed).toBe(true)
  expect(marked).toEqual(['CUP01:close'])
  expect(
    seatFor(c, { id: BEN, name: 'Ben', vip: false, avatar: NO_AVATAR }, platform),
  ).rejects.toThrow('This table has finished.')
})

test('a player who lost their seat since sitting down (withdrew, disqualified) leaves before the start', async () => {
  const c = room()
  await loadTournament(c, platform)
  sit(c, ANN, BEN, CY)
  seats = platformRoom({ seats: [seat(ANN, 0), seat(CY, 2)] })
  setSystemTime(START + 1000)
  const { calls, game } = runner(c)
  await tournamentTick(c, platform, game)
  expect(calls.started).toBe(1)
  expect(c.vars.game.players.map((player) => player.id)).toEqual([ANN, CY])
  expect(
    seatFor(c, { id: BEN, name: 'Ben', vip: false, avatar: NO_AVATAR }, platform),
  ).rejects.toThrow('This table is for players of Friday Cup.')
})

test('bot accounts the platform signed up sit by themselves; the table starts once the people are in, or with bots only', async () => {
  seats = platformRoom({ seats: [seat(ANN, 0), seat(BEN, 1, 'Bot Ash')] })
  const c = room()
  await loadTournament(c, platform)
  sit(c, ANN)
  setSystemTime(START + 1000)
  const { calls, game } = runner(c)
  await tournamentTick(c, platform, game)

  expect(calls.started).toBe(1)
  const bot = c.vars.game.players.find((player) => player.id === BEN)
  expect(bot).toMatchObject({ name: 'Bot Ash', bot: true, seat: 1 })

  // A table whose people never came still plays with its bots.
  seats = platformRoom({ seats: [seat(ANN, 0, 'Bot Ash'), seat(BEN, 1, 'Bot Bree')] })
  const botsOnly = room()
  await loadTournament(botsOnly, platform)
  setSystemTime(START + LATE_GRACE_MS)
  const botsOnlyRun = runner(botsOnly)
  await tournamentTick(botsOnly, platform, botsOnlyRun.game)

  expect(botsOnlyRun.calls.started).toBe(1)
  expect(botsOnly.vars.game.players.every((player) => player.bot)).toBe(true)
})
