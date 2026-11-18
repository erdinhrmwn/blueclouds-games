import { describe, expect, test } from 'bun:test'
import type { Card } from 'contracts/rooms/bust-31'
import { z } from 'zod'
import { type PlayerId, toMatchId, toPlayerId } from '../../core/domain/ids'
import type { LogEntry } from '../../core/domain/match'
import { newCommitment } from '../../core/rules/fair-rng'
import { stamp } from '../../core/rules/match'
import { kickPlayer, markAway, markBack, randomRng } from '../../core/rules/table'
import { chooseBotCard } from './bots'
import type { Game, MatchState } from './domain'
import { buildReport, logEvents, noteMove } from './match'
import { addPlayer, createGame, playCard, startGame } from './rules'

const A = toPlayerId('a')
const BOT_1 = toPlayerId('bot-1')
const C = toPlayerId('c')

function table(lives: Record<string, number>, winnerId: PlayerId | null): Game {
  let game = createGame()
  game = addPlayer(game, A, 'Ann')
  game = addPlayer(game, BOT_1, 'Bot Rain', true)
  game = addPlayer(game, C, 'Cy')
  const players = game.players.map((player) => ({ ...player, lives: lives[player.id]! }))
  if (winnerId) {
    return { ...game, players, phase: 'finished', winnerId }
  }

  return { ...game, players, phase: 'playing', winnerId: null }
}

const start: MatchState = {
  id: toMatchId('m1'),
  startedAt: '2026-11-11T10:00:00.000Z',
  out: [],
  seq: 0,
}

test('placements follow the elimination order, winner first', () => {
  // Cy goes out first; the bot goes out on the final move, which also ends the game.
  const cyOut = table({ a: 2, 'bot-1': 1, c: 0 }, null)
  const match = noteMove(start, cyOut)
  expect(match.out).toEqual([C])
  // noteMove counts a player out once.
  expect(noteMove(match, cyOut).out).toEqual([C])
  const report = buildReport(
    match,
    table({ a: 2, 'bot-1': 0, c: 0 }, A),
    'ABCD',
    '2026-11-11T10:05:00.000Z',
    [],
  )
  const byWho = Object.fromEntries(
    report.players.map((player) => [player.playerId ?? player.botName, player]),
  )
  expect(byWho.a).toMatchObject({ placement: 1, score: 2, bot: false })
  expect(byWho['Bot Rain']).toMatchObject({ placement: 2, playerId: null, bot: true })
  expect(byWho.c).toMatchObject({ placement: 3, score: 0 })
})

test('a terminated match places by lives, then the players out, last out first, with one winner', () => {
  // Cy is out; Ann and the bot both have 2 lives, so the lower seat (Ann) places first.
  const match = noteMove(start, table({ a: 2, 'bot-1': 2, c: 0 }, null))
  const report = buildReport(
    match,
    table({ a: 2, 'bot-1': 2, c: 0 }, null),
    'ABCD',
    '2026-11-11T10:05:00.000Z',
    [],
    'terminated',
  )
  const byWho = Object.fromEntries(
    report.players.map((player) => [player.playerId ?? player.botName, player]),
  )

  expect(report.endReason).toBe('terminated')
  expect(byWho.a!.placement).toBe(1)
  expect(byWho['Bot Rain']!.placement).toBe(2)
  expect(byWho.c!.placement).toBe(3)
})

test('a finished report still needs a winner', () => {
  const playing = table({ a: 2, 'bot-1': 2, c: 1 }, null)
  expect(() => buildReport(start, playing, 'ABCD', '2026-11-11T10:05:00.000Z', [])).toThrow()
})

test('a kick in the lobby empties the chair; mid-game it is played for them and the host moves on', () => {
  let lobby = createGame()
  lobby = addPlayer(lobby, A, 'Ann')
  lobby = addPlayer(lobby, C, 'Cy')
  expect(kickPlayer(lobby, C).players.map((player) => player.id)).toEqual([A])

  const playing = startGame(lobby, A, rng)
  const kicked = kickPlayer(playing, A)
  expect(kicked.players.find((player) => player.id === 'a')).toMatchObject({ away: true })
  expect(kicked.hostId).toBe(C)
  expect(kicked.players).toHaveLength(2)
})

test('match and round ids are UUIDv7, as the platform wants', () => {
  const { matchId, firstRound } = newCommitment()
  expect(z.uuidv7().safeParse(matchId).success).toBe(true)
  expect(z.uuidv7().safeParse(firstRound.roundId).success).toBe(true)
})

const rng = randomRng(() => 0.42)
const card = (kind: Card['kind'], value: number, id: string): Card => ({ id, kind, value })

/** Two players, Ann to move with a fixed hand. */
function started(): Game {
  let game = createGame()
  game = addPlayer(game, A, 'Ann')
  game = addPlayer(game, BOT_1, 'Bot Rain', true)
  return startGame(game, A, rng)
}

const withHand = (game: Game, hand: Card[], total = game.total): Game => ({
  ...game,
  total,
  players: game.players.map((player, i) => (i === game.turn ? { ...player, hand } : player)),
})

describe('logEvents', () => {
  test('start deals: every alive hand and the deck order', () => {
    const lobby = addPlayer(addPlayer(createGame(), A, 'Ann'), BOT_1, 'Bot Rain', true)
    const game = startGame(lobby, A, rng)
    const [deal] = logEvents(lobby, game)
    expect(deal).toEqual({
      type: 'deal',
      data: {
        round: 1,
        starter: 0,
        hands: {
          0: game.players[0]!.hand.map((card) => card.id),
          1: game.players[1]!.hand.map((card) => card.id),
        },
        deck: game.deck.map((card) => card.id),
      },
    })
  })

  test('a play records the card, the new total and the card drawn', () => {
    const game = withHand(started(), [card('number', 7, 'n7-0')], 10)
    const next = playCard(game, A, 'n7-0', rng)
    expect(logEvents(game, next)).toEqual([
      {
        type: 'play',
        seat: 0,
        data: { card: 'n7-0', total: 17, drew: game.deck[0]!.id, by: 'player' },
      },
    ])
    expect(logEvents(game, next, true)[0]!.data!.by).toBe('timeout')
  })

  test('a Swap records the seat it traded with, and the drawn card that went to that seat', () => {
    const game = withHand(started(), [card('swap', 0, 's-0')], 10)
    const next = playCard(game, A, 's-0', rng)
    const [play] = logEvents(game, next)

    expect(play).toEqual({
      type: 'play',
      seat: 0,
      data: { card: 's-0', total: 10, drew: game.deck[0]!.id, swapped: 1, by: 'player' },
    })
  })

  test('an empty deck logs the reshuffle before the play', () => {
    const game = {
      ...withHand(started(), [card('number', 2, 'n2-0')]),
      deck: [],
      discard: [card('number', 5, 'n5-0'), card('number', 6, 'n6-0')],
    }
    const entries = logEvents(game, playCard(game, A, 'n2-0', rng))
    expect(entries.map((entry) => entry.type)).toEqual(['reshuffle', 'play'])
    expect([...(entries[0]!.data!.deck as string[])].sort()).toEqual(['n5-0', 'n6-0'])
    expect(entries[1]!.data!.drew).toBe((entries[0]!.data!.deck as string[])[0])
  })

  test('a bust is followed by the new deal; the last bust ends the match', () => {
    const game = withHand(started(), [card('number', 9, 'n9-0')], 30)
    const next = playCard(game, A, 'n9-0', rng)
    expect(logEvents(game, next).map((event) => event.type)).toEqual(['bust', 'deal'])
    expect(logEvents(game, next)[0]).toEqual({
      type: 'bust',
      seat: 0,
      data: { card: 'n9-0', total: 39, lives: 2, eliminated: false, by: 'player' },
    })

    const last = {
      ...game,
      players: game.players.map((player) => (player.id === 'a' ? { ...player, lives: 1 } : player)),
    }
    const end = playCard(last, A, 'n9-0', rng)
    expect(logEvents(last, end, true)).toEqual([
      {
        type: 'bust',
        seat: 0,
        data: { card: 'n9-0', total: 39, lives: 0, eliminated: true, by: 'timeout' },
      },
      { type: 'finished', data: { winner: 1 } },
    ])
  })

  test('bots, away players and lobby changes', () => {
    const game = started()
    const away = markAway(game, A)
    expect(logEvents(game, away)).toEqual([{ type: 'away', seat: 0 }])
    expect(logEvents(away, markBack(away, A))).toEqual([{ type: 'back', seat: 0 }])
    const botTurn = { ...game, turn: 1 }
    const bot = botTurn.players[1]!
    const played = playCard(botTurn, bot.id, chooseBotCard(bot.hand, 0)!.id, rng)
    expect(logEvents(botTurn, played, true)[0]!.data!.by).toBe('bot')
    expect(logEvents(createGame(), addPlayer(createGame(), A, 'Ann'))).toEqual([])
  })

  test('a whole bot game logs every move in order', () => {
    let game = createGame()
    game = addPlayer(game, A, 'Ann')
    for (let i = 1; i < 6; i++) {
      game = addPlayer(game, toPlayerId(`bot-${i}`), `Bot ${i}`, true)
    }

    const entries: LogEntry[] = []
    const step = (next: Game) => {
      entries.push(...logEvents(game, next, true))
      game = next
    }

    step(startGame(game, A, randomRng()))
    while (game.phase === 'playing') {
      const player = game.players[game.turn]!
      step(playCard(game, player.id, chooseBotCard(player.hand, game.total)!.id, randomRng()))
    }

    const count = (type: string) => entries.filter((entry) => entry.type === type).length
    expect(count('deal')).toBe(game.round)
    expect(count('bust')).toBe(
      game.players.reduce((busts, player) => busts + 3 - Math.max(0, player.lives), 0),
    )
    expect(entries.at(-1)).toEqual({
      type: 'finished',
      data: { winner: game.players.find((player) => player.id === game.winnerId)!.seat },
    })
    expect(JSON.stringify(entries).length).toBeLessThan(100_000)
  })
})

test('stamp numbers events after the ones already logged', () => {
  const match = { ...start, seq: 4 }
  const { match: next, events } = stamp(
    match,
    [{ type: 'a' }, { type: 'b' }],
    Date.parse(start.startedAt) + 1500,
  )
  expect(events).toEqual([
    { seq: 4, t: 1500, type: 'a' },
    { seq: 5, t: 1500, type: 'b' },
  ])
  expect(next.seq).toBe(6)
  expect(stamp(match, [{ type: 'a' }], 0).events[0]!.t).toBe(0) // clock stepped back
})
