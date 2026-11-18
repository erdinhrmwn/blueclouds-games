// Bust 31, layer 2 (rules): pure game rules, no Rivet. Every function returns a new state or throws RuleError, so
// the room can forward the message to the player. Rules and their reasons: docs/games/bust-31/rules.md.
import { NO_AVATAR } from 'contracts/avatars'
import {
  type Card,
  DEAL,
  type GameEvent,
  HAND_SIZE,
  LIMIT,
  MIN_PLAYERS,
  type PublicView,
  START_LIVES,
} from 'contracts/rooms/bust-31'
import type { TurnClock } from 'contracts/rooms/room'
import type { PlayerId } from '../../core/domain/ids'
import { type Rng, RuleError } from '../../core/domain/table'
import { nextIndex, seatPlayer, shuffle } from '../../core/rules/table'
import type { Action, Game, Player, PlayingGame } from './domain'

/** How long a human has to play before a card is played for them. */
export const TURN_MS = 20_000
const MINUS_VALUE = 5
/** A Ten sets the total to this, whatever it was. */
export const TEN_TOTAL = 10
/** After a Double, the next player plays this many cards in a row. */
const DOUBLE_PLAYS = 2
const COPIES_PER_CARD = 4
/** Swap, Ten and Double are rarer than the first three special cards. */
const COPIES_PER_RARE_CARD = 2
const HIGHEST_NUMBER = 9
/** Extra wait after the deal animation, so the first turn never starts mid-flight. */
const DEAL_SETTLE_MS = 100

export function createGame(): Game {
  return {
    phase: 'lobby',
    hostId: null,
    players: [],
    deck: [],
    discard: [],
    total: 0,
    turn: 0,
    direction: 1,
    playsLeft: 1,
    round: 0,
    winnerId: null,
    lastEvent: null,
    moves: 0,
  }
}

/** 54 cards: 1–9 four times each, four each of 0, −5 and reverse, two each of Swap, Ten and Double. */
export function buildDeck(): Card[] {
  const cards: Card[] = []
  for (let copy = 0; copy < COPIES_PER_CARD; copy++) {
    for (let value = 1; value <= HIGHEST_NUMBER; value++) {
      cards.push({ id: `n${value}-${copy}`, kind: 'number', value })
    }

    cards.push({ id: `z-${copy}`, kind: 'zero', value: 0 })
    cards.push({ id: `m-${copy}`, kind: 'minus', value: -MINUS_VALUE })
    cards.push({ id: `r-${copy}`, kind: 'reverse', value: 0 })
  }

  for (let copy = 0; copy < COPIES_PER_RARE_CARD; copy++) {
    cards.push({ id: `s-${copy}`, kind: 'swap', value: 0 })
    cards.push({ id: `t-${copy}`, kind: 'ten', value: 0 })
    cards.push({ id: `d-${copy}`, kind: 'double', value: 0 })
  }

  return cards
}

/** The total after `card` is played on `total`: a Ten sets it, every other card adds its value (never below 0). */
export function totalAfter(total: number, card: Card): number {
  if (card.kind === 'ten') {
    return TEN_TOTAL
  }

  return Math.max(0, total + card.value)
}

/** Sits a new player in `seat`, or in the first free one when no seat is given. */
export function addPlayer(
  game: Game,
  id: PlayerId,
  name: string,
  bot = false,
  seat?: number,
): Game {
  if (game.players.some((player) => player.id === id)) {
    return game
  }

  const player = { id, name, lives: START_LIVES, hand: [], bot }
  const seated = seatPlayer<Game, Player>(game, player, seat)

  return { ...seated, lastEvent: { type: 'joined', playerId: id } }
}

export function startGame(game: Game, byId: PlayerId | null, rng: Rng): Game {
  if (game.hostId !== byId) {
    throw new RuleError('Only the host can start the game.')
  }

  if (game.phase === 'playing') {
    throw new RuleError('The game is already running.')
  }

  if (game.players.length < MIN_PLAYERS) {
    throw new RuleError(`Needs at least ${MIN_PLAYERS} players.`)
  }

  const players = game.players.map((player) => ({ ...player, lives: START_LIVES, hand: [] }))
  const playing: PlayingGame = { ...game, players, round: 0, phase: 'playing', winnerId: null }
  const dealt = dealRound(playing, 0, rng)

  return { ...dealt, lastEvent: { type: 'started' }, moves: game.moves + 1 }
}

export function playCard(game: Game, playerId: PlayerId, cardId: string, rng: Rng): Game {
  if (game.phase !== 'playing') {
    throw new RuleError('The game has not started yet.')
  }

  const current = game.players[game.turn]
  if (current?.id !== playerId) {
    throw new RuleError('It is not your turn yet.')
  }

  const card = current.hand.find((held) => held.id === cardId)
  if (!card) {
    throw new RuleError('That card is not in your hand.')
  }

  const total = totalAfter(game.total, card)
  const hand = current.hand.filter((held) => held.id !== cardId)

  if (total > LIMIT) {
    return bust(game, current, card, total, hand, rng)
  }

  let { deck, discard } = game
  discard = [...discard, card]
  if (deck.length === 0) {
    // The card just played stays on the pile; everything under it becomes the new deck.
    deck = shuffle(discard.slice(0, -1), rng, game.round)
    discard = [card]
  }

  const [drawn, ...rest] = deck
  const newHand = drawn ? [...hand, drawn] : hand
  let players = game.players.map((player) =>
    player.id === playerId ? { ...player, hand: newHand } : player,
  )
  const direction = card.kind === 'reverse' ? (-game.direction as 1 | -1) : game.direction
  const next = nextAlive(players, game.turn, direction)

  const event: GameEvent = { type: 'played', playerId, card, total }
  if (card.kind === 'swap') {
    players = swapHands(players, game.turn, next)
    event.swappedWith = players[next]!.id
  }

  // A Double hands the next player two plays (and ends any the player still owed).
  // Otherwise a player who owes another play keeps the turn.
  let turn = next
  let playsLeft = 1
  if (card.kind === 'double') {
    playsLeft = DOUBLE_PLAYS
  } else if ((game.playsLeft ?? 1) > 1) {
    // Rooms saved before Double existed have no playsLeft: they owe one play.
    turn = game.turn
    playsLeft = game.playsLeft - 1
  }

  return {
    ...game,
    players,
    deck: rest,
    discard,
    total,
    direction,
    turn,
    playsLeft,
    lastEvent: event,
    moves: game.moves + 1,
  }
}

/** The players at `a` and `b` trade hands. */
function swapHands(players: Player[], seatA: number, seatB: number): Player[] {
  const handA = players[seatA]!.hand
  const handB = players[seatB]!.hand

  return players.map((player, index) => {
    if (index === seatA) {
      return { ...player, hand: handB }
    }

    if (index === seatB) {
      return { ...player, hand: handA }
    }

    return player
  })
}

/** The total went over LIMIT: the player loses a life, then a new round, or the end of the match. */
function bust(
  game: PlayingGame,
  current: Player,
  card: Card,
  total: number,
  hand: Card[],
  rng: Rng,
): Game {
  const lives = current.lives - 1
  const players = game.players.map((player) =>
    player.id === current.id ? { ...player, lives, hand } : player,
  )
  const alive = players.filter((player) => player.lives > 0)

  if (alive.length === 1) {
    const winnerId = alive[0]!.id
    return {
      ...game,
      players,
      total,
      phase: 'finished',
      winnerId,
      lastEvent: { type: 'finished', winnerId },
      moves: game.moves + 1,
    }
  }

  // Loser starts the next round; if they are out, the next alive seat does.
  const starter = lives > 0 ? game.turn : nextAlive(players, game.turn, game.direction)
  const event: GameEvent = {
    type: 'bust',
    playerId: current.id,
    card,
    total,
    eliminated: lives === 0,
  }

  return {
    ...dealRound({ ...game, players }, starter, rng),
    lastEvent: event,
    moves: game.moves + 1,
  }
}

/** Host sends everyone back to the lobby after a finished game. */
export function resetToLobby(game: Game, byId: PlayerId): Game {
  if (game.hostId !== byId) {
    throw new RuleError('Only the host can start over.')
  }

  if (game.phase !== 'finished') {
    throw new RuleError('The game is not over yet.')
  }

  // Players who walked away mid-game don't come back to the lobby.
  const players = game.players
    .filter((player) => !player.away)
    .map((player) => ({ ...player, lives: START_LIVES, hand: [] }))

  return {
    ...createGame(),
    moves: game.moves,
    hostId: game.hostId,
    players,
  }
}

function dealRound(game: PlayingGame, starter: number, rng: Rng): PlayingGame {
  const round = game.round + 1
  let deck = shuffle(buildDeck(), rng, round)
  const players = game.players.map((player) => {
    if (player.lives <= 0) {
      return { ...player, hand: [] }
    }

    const hand = deck.slice(0, HAND_SIZE)
    deck = deck.slice(HAND_SIZE)
    return { ...player, hand }
  })

  return {
    ...game,
    players,
    deck,
    discard: [],
    total: 0,
    direction: 1,
    playsLeft: 1,
    turn: starter,
    round,
  }
}

const nextAlive = (players: Player[], from: number, direction: 1 | -1) =>
  nextIndex(players, from, direction, (player) => player.lives > 0)

/**
 * What every player may see: no hands, no deck order.
 * `turn` is relative (ms left, full length) so clients with a wrong clock still count down correctly.
 */
export function publicView(game: Game, turn: TurnClock | null = null): PublicView {
  return {
    phase: game.phase,
    hostId: game.hostId,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      lives: player.lives,
      bot: player.bot,
      seat: player.seat,
      away: !!player.away,
      vip: !!player.vip,
      avatar: player.avatar ?? NO_AVATAR,
    })),
    deckCount: game.deck.length,
    topCard: game.discard.at(-1) ?? null,
    /** Up to three cards played before the top one, oldest first. */
    pileUnder: game.discard.slice(-4, -1),
    total: game.total,
    limit: LIMIT,
    turnPlayerId: game.phase === 'playing' ? (game.players[game.turn]?.id ?? null) : null,
    direction: game.direction,
    /** Cards the player on turn still has to play this turn (2 after a Double). */
    playsLeft: game.playsLeft ?? 1,
    round: game.round,
    winnerId: game.winnerId,
    lastEvent: game.lastEvent,
    moves: game.moves,
    turn,
  }
}

/**
 * How long the first turn of a fresh round waits for the dealing animation
 * (plus the bust stamp before it). 0 for any other turn.
 */
export function dealPauseMs(game: Game): number {
  const event = game.lastEvent
  if (game.phase !== 'playing') {
    return 0
  }

  if (event?.type !== 'started' && event?.type !== 'bust') {
    return 0
  }

  const alive = game.players.filter((player) => player.lives > 0).length
  const bustStampMs = event.type === 'bust' ? DEAL.afterBustMs : 0
  const dealMs = alive * HAND_SIZE * DEAL.stepMs + DEAL.flightMs

  return bustStampMs + dealMs + DEAL_SETTLE_MS
}

export function handOf(game: Game, playerId: PlayerId): Card[] {
  return game.players.find((player) => player.id === playerId)?.hand ?? []
}

/** A player's move, whichever it is. */
export function applyAction(game: Game, playerId: PlayerId, action: Action, rng: Rng): Game {
  switch (action.type) {
    case 'play':
      return playCard(game, playerId, action.cardId, rng)
  }
}

/** A card played for a human (timeout or away) is marked, so the table can say so. */
export function markAuto(game: Game): Game {
  const event = game.lastEvent
  if (event?.type !== 'played' && event?.type !== 'bust') {
    return game
  }

  return { ...game, lastEvent: { ...event, auto: true } }
}
