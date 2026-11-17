import { describe, expect, test } from 'bun:test'
import { type Card, DEAL, LIMIT, START_LIVES } from 'contracts/rooms/bust-31'
import {
  markAway,
  markBack,
  markVip,
  RuleError,
  randomRng,
  removePlayer,
  takeSeat,
} from '../shared/table'
import { chooseBotCard } from './bots'
import {
  addPlayer,
  buildDeck,
  createGame,
  dealPauseMs,
  type Game,
  playCard,
  publicView,
  resetToLobby,
  startGame,
  TEN_TOTAL,
} from './rules'

const rng = randomRng(() => 0.42)
const card = (kind: Card['kind'], value: number, id = `${kind}${value}`): Card => ({
  id,
  kind,
  value,
})

function twoPlayerGame(): Game {
  let game = createGame()
  game = addPlayer(game, 'a', 'Ann')
  game = addPlayer(game, 'b', 'Bob')
  return startGame(game, 'a', rng)
}

function threePlayerGame(): Game {
  let game = createGame()
  game = addPlayer(game, 'a', 'Ann')
  game = addPlayer(game, 'b', 'Bob')
  game = addPlayer(game, 'c', 'Cleo')
  return startGame(game, 'a', rng)
}

/** Puts a fixed hand on the current player so tests control the play. */
function withHand(game: Game, hand: Card[], total = game.total): Game {
  return {
    ...game,
    total,
    players: game.players.map((player, i) => (i === game.turn ? { ...player, hand } : player)),
  }
}

describe('lobby', () => {
  test('first player hosts, joining twice is a no-op, start needs the host and two players, no joining after', () => {
    let game = addPlayer(createGame(), 'a', 'Ann')
    game = addPlayer(game, 'a', 'Ann')
    expect(game.hostId).toBe('a')
    expect(game.players).toHaveLength(1)
    expect(() => startGame(game, 'a', rng)).toThrow(RuleError)

    const two = addPlayer(game, 'b', 'Bob')
    expect(() => startGame(two, 'b', rng)).toThrow('host')
    expect(() => addPlayer(twoPlayerGame(), 'c', 'Cleo')).toThrow(RuleError)
  })
})

describe('seats', () => {
  test('players fill the first free seat, a bot can take a chosen one, a full table has none', () => {
    let game = addPlayer(createGame(), 'a', 'Ann')
    game = addPlayer(game, 'bot', 'Bot', true, 4)
    game = addPlayer(game, 'b', 'Bob')
    expect(game.players.map((player) => [player.id, player.seat])).toEqual([
      ['a', 0],
      ['b', 1],
      ['bot', 4],
    ])
    expect(() => addPlayer(game, 'c', 'Cleo', false, 4)).toThrow('taken')
    expect(() => addPlayer(game, 'c', 'Cleo', false, 6)).toThrow('does not exist')

    for (const id of ['c', 'd', 'e']) {
      game = addPlayer(game, id, id)
    }

    expect(() => addPlayer(game, 'g', 'g')).toThrow('full')
  })

  test('moving seats keeps players in seat order, so turns follow the table', () => {
    let game = addPlayer(addPlayer(addPlayer(createGame(), 'a', 'Ann'), 'b', 'Bob'), 'c', 'Cleo')
    game = takeSeat(game, 'a', 5)
    expect(game.players.map((player) => player.id)).toEqual(['b', 'c', 'a'])
    const started = startGame(game, 'a', rng)
    expect(started.players[started.turn]!.id).toBe('b')
    expect(() => takeSeat(started, 'b', 3)).toThrow('locked')
  })
})

describe('deal', () => {
  test('deck has 54 unique cards and each player gets 3', () => {
    const deck = buildDeck()
    expect(new Set(deck.map((card) => card.id)).size).toBe(54)

    const rare = deck.filter(
      (card) => card.kind === 'swap' || card.kind === 'ten' || card.kind === 'double',
    )
    expect(rare).toHaveLength(6)

    const game = twoPlayerGame()
    expect(game.players.every((player) => player.hand.length === 3)).toBe(true)
    expect(game.deck).toHaveLength(54 - 6)
    expect(game.playsLeft).toBe(1)
  })
})

describe('playing', () => {
  test('rejects playing out of turn or a card not in hand', () => {
    const game = twoPlayerGame()
    const other = game.players[1 - game.turn]!
    expect(() => playCard(game, other.id, other.hand[0]!.id, rng)).toThrow('not your turn')
    expect(() => playCard(game, game.players[game.turn]!.id, 'nope', rng)).toThrow(
      'not in your hand',
    )
  })

  test('adds value, draws a card and passes the turn', () => {
    const game = withHand(twoPlayerGame(), [card('number', 7)], 10)
    const me = game.players[game.turn]!.id
    const next = playCard(game, me, 'number7', rng)
    expect(next.total).toBe(17)
    expect(next.players.find((player) => player.id === me)!.hand).toHaveLength(1)
    expect(next.players[next.turn]!.id).not.toBe(me)
  })

  test('a minus never drops the total below zero, a Ten sets it to 10 up or down, reverse flips', () => {
    const cases: { played: Card; before: number; total: number; direction: number }[] = [
      { played: card('minus', -5), before: 3, total: 0, direction: 1 },
      { played: card('ten', 0), before: 28, total: TEN_TOTAL, direction: 1 },
      { played: card('ten', 0), before: 3, total: TEN_TOTAL, direction: 1 },
      { played: card('reverse', 0), before: 12, total: 12, direction: -1 },
    ]

    for (const { played, before, total, direction } of cases) {
      const game = withHand(twoPlayerGame(), [played], before)
      const next = playCard(game, game.players[game.turn]!.id, played.id, rng)
      expect([played.id, next.total, next.direction]).toEqual([played.id, total, direction])
    }
  })

  test('a Swap trades hands with the next player and passes the turn to them', () => {
    let game = threePlayerGame()
    const swap = card('swap', 0)
    const theirs = [card('number', 1, 'x1'), card('number', 2, 'x2'), card('number', 3, 'x3')]
    game = withHand(game, [swap, card('number', 9, 'k1'), card('number', 8, 'k2')], 12)
    const me = game.players[game.turn]!.id
    const nextSeat = (game.turn + 1) % game.players.length
    game = {
      ...game,
      players: game.players.map((player, i) =>
        i === nextSeat ? { ...player, hand: theirs } : player,
      ),
    }
    const drawnCard = game.deck[0]!

    const after = playCard(game, me, swap.id, rng)
    const mine = after.players.find((player) => player.id === me)!.hand.map((card) => card.id)
    const next = after.players[nextSeat]!

    expect(mine).toEqual(['x1', 'x2', 'x3'])
    expect(next.hand.map((card) => card.id)).toEqual(['k1', 'k2', drawnCard.id])
    expect(after.turn).toBe(nextSeat)
    expect(after.total).toBe(12)
    expect(after.lastEvent).toMatchObject({ type: 'played', swappedWith: next.id })
  })

  test('after a Double the next player plays two cards in a row, then the turn moves on', () => {
    let game = withHand(threePlayerGame(), [card('double', 0)], 5)
    const first = game.turn
    game = playCard(game, game.players[first]!.id, 'double0', rng)

    const second = game.turn
    expect(second).not.toBe(first)
    expect(game.playsLeft).toBe(2)
    expect(publicView(game).playsLeft).toBe(2)

    game = withHand(game, [card('number', 1, 'a1'), card('number', 2, 'a2')])
    game = playCard(game, game.players[second]!.id, 'a1', rng)
    expect(game.turn).toBe(second)
    expect(game.playsLeft).toBe(1)

    game = playCard(game, game.players[second]!.id, 'a2', rng)
    expect(game.turn).not.toBe(second)
    expect(game.playsLeft).toBe(1)
    expect(game.total).toBe(8)
  })

  test('a Double played while owing two plays passes both plays on and ends your own', () => {
    let game = withHand(threePlayerGame(), [card('double', 0, 'd1')], 5)
    game = playCard(game, game.players[game.turn]!.id, 'd1', rng)
    const owing = game.turn

    game = withHand(game, [card('double', 0, 'd2')])
    game = playCard(game, game.players[owing]!.id, 'd2', rng)
    expect(game.turn).not.toBe(owing)
    expect(game.playsLeft).toBe(2)
  })

  test('busting while owing two plays deals a new round with one play', () => {
    let game = withHand(threePlayerGame(), [card('double', 0)], 25)
    game = playCard(game, game.players[game.turn]!.id, 'double0', rng)
    const owing = game.players[game.turn]!.id

    game = withHand(game, [card('number', 9)])
    game = playCard(game, owing, 'number9', rng)
    expect(game.lastEvent?.type).toBe('bust')
    expect(game.playsLeft).toBe(1)
  })

  test('reshuffles the discard pile when the deck runs out', () => {
    const base = withHand(twoPlayerGame(), [card('number', 1)], 0)
    const game = { ...base, deck: [], discard: [card('number', 2, 'x'), card('number', 3, 'y')] }
    const next = playCard(game, game.players[game.turn]!.id, 'number1', rng)
    expect(next.deck).toHaveLength(1) // 2 cards shuffled back, 1 drawn
    expect(next.discard.map((card) => card.id)).toEqual(['number1']) // the played card stays on the pile
  })

  test(`going over ${LIMIT} costs a life and starts a new round`, () => {
    const game = withHand(twoPlayerGame(), [card('number', 9)], 30)
    const me = game.players[game.turn]!.id
    const next = playCard(game, me, 'number9', rng)
    expect(next.players.find((player) => player.id === me)!.lives).toBe(START_LIVES - 1)
    expect(next.total).toBe(0)
    expect(next.round).toBe(2)
    expect(next.players[next.turn]!.id).toBe(me)
    expect(next.lastEvent?.type).toBe('bust')
  })

  test('last player standing wins, host can reset to lobby', () => {
    let game = withHand(twoPlayerGame(), [card('number', 9)], 30)
    game = {
      ...game,
      players: game.players.map((player, i) =>
        i === game.turn ? { ...player, lives: 1 } : player,
      ),
    }
    const loser = game.players[game.turn]!.id
    const done = playCard(game, loser, 'number9', rng)
    expect(done.phase).toBe('finished')
    expect(done.winnerId).not.toBe(loser)

    const lobby = resetToLobby(done, 'a')
    expect(lobby.phase).toBe('lobby')
    expect(lobby.players.every((player) => player.lives === START_LIVES)).toBe(true)
  })
})

describe('away and VIP players', () => {
  test("a player who left mid-game keeps the seat and isn't taken back to the lobby; only the marked one is VIP", () => {
    const game = markAway(twoPlayerGame(), 'b')
    expect(game.players.find((player) => player.id === 'b')?.away).toBe(true)
    const done = { ...game, phase: 'finished' as const }
    expect(resetToLobby(done, 'a').players.map((player) => player.id)).toEqual(['a'])
    expect(markBack(game, 'b').players.find((player) => player.id === 'b')?.away).toBe(false)

    const shown = publicView(markVip(twoPlayerGame(), 'b')).players.map((player) => [
      player.id,
      player.vip,
    ])
    expect(shown).toEqual([
      ['a', false],
      ['b', true],
    ])
  })
})

describe('deal pause', () => {
  test('holds the first turn of a round for the dealing animation, longer after a bust', () => {
    const game = twoPlayerGame()
    const dealing = 2 * 3 * DEAL.stepMs + DEAL.flightMs + 100
    expect(dealPauseMs(game)).toBe(dealing)
    const played = playCard(
      withHand(game, [card('number', 1)], 0),
      game.players[game.turn]!.id,
      'number1',
      rng,
    )
    expect(dealPauseMs(played)).toBe(0)
    const bust = playCard(
      withHand(game, [card('number', 9)], 30),
      game.players[game.turn]!.id,
      'number9',
      rng,
    )
    expect(dealPauseMs(bust)).toBe(DEAL.afterBustMs + dealing)
  })
})

describe('move counter', () => {
  test('counts every deal and play, and survives going back to the lobby', () => {
    const game = withHand(twoPlayerGame(), [card('number', 9)], 30)
    expect(game.moves).toBe(1)
    const afterBust = playCard(
      {
        ...game,
        players: game.players.map((player, i) =>
          i === game.turn ? { ...player, lives: 1 } : player,
        ),
      },
      game.players[game.turn]!.id,
      'number9',
      rng,
    )
    expect(afterBust.moves).toBe(2)
    expect(resetToLobby(afterBust, 'a').moves).toBe(2)
  })
})

describe('bot', () => {
  test('a bot never becomes host, and host passes to a human', () => {
    let game = addPlayer(createGame(), 'bot1', 'Bot', true)
    game = addPlayer(game, 'a', 'Ann')
    game = addPlayer(game, 'b', 'Bob')
    expect(game.hostId).toBe('a')
    expect(removePlayer(game, 'a').hostId).toBe('b')
  })

  test('plays the biggest safe number, saves the Ten and -5 for emergencies, else the smallest card', () => {
    const cases: { hand: Card[]; total: number; picks: string }[] = [
      {
        hand: [card('number', 3), card('number', 8), card('minus', -5)],
        total: 20,
        picks: 'number8',
      },
      { hand: [card('number', 9), card('minus', -5)], total: 30, picks: 'minus-5' },
      { hand: [card('number', 9), card('number', 4)], total: 30, picks: 'number4' },
      { hand: [card('ten', 0), card('minus', -5), card('swap', 0)], total: 30, picks: 'swap0' },
      { hand: [card('number', 9), card('ten', 0)], total: 30, picks: 'ten0' },
    ]

    for (const { hand, total, picks } of cases) {
      expect(chooseBotCard(hand, total)?.id).toBe(picks)
    }
  })
})
