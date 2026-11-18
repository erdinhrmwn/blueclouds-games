// Bust 31, layer 2 (rules): the game as its room runs it (core/domain/game.ts). Pure: it only bundles the rules.

import type { Hand, PublicView } from 'contracts/rooms/bust-31'
import type { GameDefinition } from '../../core/domain/game'
import { chooseBotAction } from './bots'
import type { Action, Game, MatchState } from './domain'
import { buildReport, logEvents, noteMove, roundResult } from './match'
import {
  addPlayer,
  applyAction,
  createGame,
  dealPauseMs,
  handOf,
  markAuto,
  publicView,
  resetToLobby,
  startGame,
  TURN_MS,
} from './rules'

export const bust31: GameDefinition<Game, MatchState, Action, PublicView, Hand> = {
  slug: 'bust-31',
  title: 'Bust 31',
  icon: 'fire',

  createGame,
  newMatch: () => ({ out: [] }),
  // Rooms saved before move counting and fixed seats existed.
  upgrade: (game) => ({
    ...game,
    moves: game.moves ?? 0,
    players: game.players.map((player, index) => ({ ...player, seat: player.seat ?? index })),
  }),

  addPlayer,
  startGame,
  resetToLobby,
  applyAction,
  autoAction: chooseBotAction,
  markAuto,

  turnMs: TURN_MS,
  turnKey: (game) => game.moves,
  dealPauseMs,

  publicView,
  handOf,

  logEvents,
  noteMove,
  roundResult,
  buildReport,
}
