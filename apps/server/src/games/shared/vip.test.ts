import { beforeEach, expect, mock, test } from 'bun:test'

// The platform is replaced: these tests are about which tags change and when the check runs again.
let vipIds = new Set<string>()
let platformDown = false
mock.module('../../platform', () => ({
  verifyPlayToken: async () => null,
  reportMatch: async () => ({ result: 'sent' }),
  reportRound: async () => ({ result: 'sent' }),
  fetchRoomSeats: async () => null,
  markRoom: async () => ({ ok: true }),
  fetchVipIds: async () => {
    if (platformDown) {
      throw new Error('platform down')
    }

    return vipIds
  },
}))
const { refreshVips, VIP_REFRESH_MS } = await import('./room')
const { addPlayer, createGame } = await import('../bust-31/rules')
const { markVip, showAvatar, showVips } = await import('./table')

const DUE = 1_000

function room(connections: number) {
  const scheduled: number[] = []
  let game = createGame()
  game = addPlayer(game, 'ann', 'Ann')
  game = addPlayer(game, 'ben', 'Ben')
  game = addPlayer(game, 'bot', 'Bot Rain', true)

  return {
    scheduled,
    vars: { game, vipCheckAt: DUE as number | null },
    conns: new Map(Array.from({ length: connections }, (_, i) => [`conn${i}`, {}])),
    log: { warn: () => {} },
    schedule: { at: async (at: number) => void scheduled.push(at) },
  }
}

const vipsOf = (c: ReturnType<typeof room>) =>
  c.vars.game.players.filter((player) => player.vip).map((player) => player.id)

beforeEach(() => {
  vipIds = new Set()
  platformDown = false
})

test('a grant and a revoke both reach the seated tags, bots are left alone; no change sends nothing', async () => {
  const c = room(1)
  c.vars.game = markVip(c.vars.game, 'ben')
  vipIds = new Set(['ann'])

  expect(await refreshVips(c, DUE)).toBe(true)
  expect(vipsOf(c)).toEqual(['ann'])
  expect(c.vars.game.players.find((player) => player.id === 'bot')?.vip).toBeUndefined()

  const unchanged = room(1)
  unchanged.vars.game = markVip(unchanged.vars.game, 'ann')
  expect(await refreshVips(unchanged, DUE)).toBe(false)
  expect(showVips(unchanged.vars.game, vipIds)).toBe(unchanged.vars.game)
})

test('keeps checking while someone is connected or the platform is down; stops when empty; ignores a stale timer', async () => {
  const open = room(2)
  await refreshVips(open, DUE)
  expect(open.scheduled).toHaveLength(1)
  expect(open.scheduled[0]! - Date.now()).toBeLessThanOrEqual(VIP_REFRESH_MS)

  const empty = room(0)
  await refreshVips(empty, DUE)
  expect(empty.scheduled).toHaveLength(0)
  expect(empty.vars.vipCheckAt).toBeNull()

  // A timer from before a sleep is ignored.
  const stale = room(1)
  vipIds = new Set(['ann'])
  expect(await refreshVips(stale, DUE - 1)).toBe(false)
  expect(vipsOf(stale)).toEqual([])
  expect(stale.scheduled).toHaveLength(0)

  const down = room(1)
  platformDown = true
  expect(await refreshVips(down, DUE)).toBe(false)
  expect(down.scheduled).toHaveLength(1)
})

test("a player's avatar is shown, and an unchanged one keeps the same game", () => {
  let game = createGame()
  game = addPlayer(game, 'ann', 'Ann')
  const kite = { color: 'storm', icon: 'kite' } as const

  const shown = showAvatar(game, 'ann', kite)
  expect(shown.players[0]!.avatar).toEqual(kite)
  expect(showAvatar(shown, 'ann', { ...kite })).toBe(shown)
  expect(showAvatar(shown, 'nobody', kite)).toBe(shown)
})
