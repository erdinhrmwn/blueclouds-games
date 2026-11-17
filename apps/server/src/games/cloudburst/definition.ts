// Cloudburst, layer 2 (rules): the game as its room runs it (core/domain/game.ts). Pure: it only bundles the rules.

import type { Hand, PublicView } from 'contracts/rooms/cloudburst'
import type { GameDefinition } from '../../core/domain/game'
import { chooseBotMove } from './bots'
import type { Action, Game, MatchState } from './domain'
import { buildReport, logEvents, roundResult } from './match'
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

/** After a bot (or the timer) draws, it plays or passes this much later, so the draw shows first. */
const AFTER_DRAW_MS = 900

export const cloudburst: GameDefinition<Game, MatchState, Action, PublicView, Hand> = {
  slug: 'cloudburst',
  title: 'Cloudburst',
  icon: 'cloud-bolt',

  createGame,
  newMatch: () => ({}),

  addPlayer,
  startGame,
  resetToLobby,
  applyAction,
  autoAction: chooseBotMove,
  markAuto,
  // After a draw the same turn goes on: play or pass a moment later.
  followUpMs: (action) => (action.type === 'draw' ? AFTER_DRAW_MS : null),

  turnMs: TURN_MS,
  turnKey: (game) => game.turnKey,
  dealPauseMs,

  publicView,
  handOf,

  logEvents,
  roundResult,
  buildReport,
}
