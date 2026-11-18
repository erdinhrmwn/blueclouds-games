import { beforeEach, expect, test } from 'bun:test'
import type { Game, MatchState } from '../../games/bust-31/domain'
import { addPlayer, createGame } from '../../games/bust-31/rules'
import { type PlayerId, toPlayerId } from '../domain/ids'
import { markVip, showAvatar, showVips } from '../rules/table'
import type { RoomConn, RoomCtx } from './context'
import { fakePlatform } from './fakes'
import { roomVars } from './state'
import { refreshVips, VIP_REFRESH_MS } from './vip'

const ANN = toPlayerId('ann')
const BEN = toPlayerId('ben')
const BOT = toPlayerId('bot')
const NOBODY = toPlayerId('nobody')

// The platform is a fake: these tests are about which tags change and when the check runs again.
let vipIds = new Set<PlayerId>()
let platformDown = false
const platform = fakePlatform({
  fetchVipIds: async () => {
    if (platformDown) {
      throw new Error('platform down')
    }

    return vipIds
  },
})

const DUE = 1_000

interface FakeRoom extends RoomCtx<Game, MatchState> {
  scheduled: number[]
}

function connection(id: string): RoomConn {
  return {
    id,
    params: null,
    send: () => {},
    disconnect: () => {},
  }
}

function room(connections: number): FakeRoom {
  const scheduled: number[] = []
  let game = createGame()
  game = addPlayer(game, ANN, 'Ann')
  game = addPlayer(game, BEN, 'Ben')
  game = addPlayer(game, BOT, 'Bot Rain', true)

  const ids = Array.from({ length: connections }, (_, index) => `conn${index}`)

  return {
    scheduled,
    vars: { ...roomVars<Game, MatchState>(game), vipCheckAt: DUE },
    key: ['VIP01'],
    conns: new Map(ids.map((id) => [id, connection(id)])),
    broadcast: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    schedule: {
      after: async () => {},
      at: async (at: number) => {
        scheduled.push(at)
      },
    },
  }
}

const vipsOf = (c: FakeRoom) =>
  c.vars.game.players.filter((player) => player.vip).map((player) => player.id)

beforeEach(() => {
  vipIds = new Set<PlayerId>()
  platformDown = false
})

test('a grant and a revoke both reach the seated tags, bots are left alone; no change sends nothing', async () => {
  const c = room(1)
  c.vars.game = markVip(c.vars.game, BEN)
  vipIds = new Set([ANN])

  expect(await refreshVips(c, DUE, platform)).toBe(true)
  expect(vipsOf(c)).toEqual([ANN])
  expect(c.vars.game.players.find((player) => player.id === 'bot')?.vip).toBeUndefined()

  const unchanged = room(1)
  unchanged.vars.game = markVip(unchanged.vars.game, ANN)
  expect(await refreshVips(unchanged, DUE, platform)).toBe(false)
  expect(showVips(unchanged.vars.game, vipIds)).toBe(unchanged.vars.game)
})

test('keeps checking while someone is connected or the platform is down; stops when empty; ignores a stale timer', async () => {
  const open = room(2)
  await refreshVips(open, DUE, platform)
  expect(open.scheduled).toHaveLength(1)
  expect(open.scheduled[0]! - Date.now()).toBeLessThanOrEqual(VIP_REFRESH_MS)

  const empty = room(0)
  await refreshVips(empty, DUE, platform)
  expect(empty.scheduled).toHaveLength(0)
  expect(empty.vars.vipCheckAt).toBeNull()

  // A timer from before a sleep is ignored.
  const stale = room(1)
  vipIds = new Set([ANN])
  expect(await refreshVips(stale, DUE - 1, platform)).toBe(false)
  expect(vipsOf(stale)).toEqual([])
  expect(stale.scheduled).toHaveLength(0)

  const down = room(1)
  platformDown = true
  expect(await refreshVips(down, DUE, platform)).toBe(false)
  expect(down.scheduled).toHaveLength(1)
})

test("a player's avatar is shown, and an unchanged one keeps the same game", () => {
  let game = createGame()
  game = addPlayer(game, ANN, 'Ann')
  const kite = { color: 'storm', icon: 'kite' } as const

  const shown = showAvatar(game, ANN, kite)
  expect(shown.players[0]!.avatar).toEqual(kite)
  expect(showAvatar(shown, ANN, { ...kite })).toBe(shown)
  expect(showAvatar(shown, NOBODY, kite)).toBe(shown)
})
