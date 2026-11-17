// Layer 3, room: one room actor for any game. The game brings its definition (pure rules) and its own moves; this
// file runs the rest the same way for every game: joining and seats, the turn clock, bots, kicks, tournaments,
// VIP tags and the outbox. It is also where a room meets its adapters (core/adapters/ports.ts).

import type { RoomExtras } from 'contracts/rooms/room'
import { actor, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import { type AdapterCtx, roomPorts } from '../adapters/ports'
import { migrateRoom } from '../adapters/room-store'
import type { GameDefinition } from '../domain/game'
import type { LogEntry, MatchState } from '../domain/match'
import type { RoomPorts } from '../domain/ports'
import type { CurrentTurn } from '../domain/room'
import type { GameTable } from '../domain/table'
import { botName, markBack, markVip, removePlayer, showAvatar, takeSeat } from '../rules/table'
import { fairnessView, tournamentView, turnClock } from '../rules/views'
import {
  apply,
  caller,
  checkConnect,
  identify,
  parseSeat,
  playerOf,
  requireAdmin,
  requireHost,
  requireOpenTable,
  requirePlayer,
  requireScheduler,
  scheduledWhileOpen,
} from './access'
import { beginMatch, type CommitSteps, commitRoom, withRng } from './commit'
import type { ActionCtx, RoomCtx } from './context'
import { AdminKickInput, AdminTerminateInput, BotIdInput } from './inputs'
import { reportToDirectory } from './listing'
import {
  closeKicked,
  closeTerminated,
  dropIfGone,
  kickFromTable,
  terminateTable,
} from './moderation'
import { resumeReports, sendReports } from './reports'
import { loadRoom, roomVars } from './state'
import { seatFor, tournamentTick, wakeTournament } from './tournament'
import { armTurn } from './turn'
import { armVipRefresh, refreshVips } from './vip'

/** How long a closed tab has to come back (a refresh) before its player leaves the table. */
export const GONE_AFTER_MS = 15_000

/** A room actor's context: what the room layer reads, plus what its adapters are built from. */
interface ActorCtx<G extends GameTable, M extends MatchState> extends RoomCtx<G, M>, AdapterCtx {}

/** An action's context in a room actor. */
export interface ActorActionCtx<G extends GameTable, M extends MatchState>
  extends ActionCtx<G, M>, AdapterCtx {}

/** A game's own action (play, draw, …), as the actor runs it. */
export type MoveHandler<G extends GameTable, M extends MatchState> = (
  c: ActorActionCtx<G, M>,
  input?: unknown,
) => Promise<void>

/** What the room gives a game for its own moves. */
export interface RoomKit<G extends GameTable, M extends MatchState, Action> {
  /** An action that parses its input into the game's Action, plays it for the caller, then commits. */
  move(parse: (input: unknown) => Action): MoveHandler<G, M>
}

/**
 * The room actor of a game. `moves` are the game's own actions (play, draw, …): each parses its input into the
 * game's Action and hands it to `room.move`.
 */
export function createRoom<
  G extends GameTable,
  M extends MatchState,
  Action,
  View extends object,
  Hand,
  Moves extends object,
>(game: GameDefinition<G, M, Action, View, Hand>, moves: (room: RoomKit<G, M, Action>) => Moves) {
  type Ctx = ActorCtx<G, M>
  type Act = ActorActionCtx<G, M>

  const ports = (c: Ctx): RoomPorts => roomPorts(c)

  const viewOf = (c: RoomCtx<G, M>): View & RoomExtras => {
    const now = Date.now()

    return {
      ...game.publicView(c.vars.game, turnClock(c.vars.timer, now)),
      tournament: tournamentView(c.vars.tournament, now),
      roomName: c.vars.roomName ?? null,
      fairness: fairnessView(c.vars),
    }
  }

  /** The player on turn, while a match is played. */
  const onTurn = (table: G) => (table.phase === 'playing' ? table.players[table.turn] : undefined)

  /** The running turn: whose it is and its key, for scheduling a move made for them. */
  const currentTurn = (c: RoomCtx<G, M>): CurrentTurn => {
    const table = c.vars.game

    return {
      playerId: table.players[table.turn]?.id ?? null,
      key: game.turnKey(table),
    }
  }

  /** Everyone gets the same clock; the clock of a fresh round starts once its deal has landed. */
  const armTurnClock = (c: RoomCtx<G, M>, resume: boolean) => {
    const table = c.vars.game

    return armTurn(c, onTurn(table), {
      key: game.turnKey(table),
      turnMs: game.turnMs,
      pause: game.dealPauseMs(table),
      resume,
      rng: Math.random,
    })
  }

  /** Saves the change (with its move log), then pushes the view to everyone and each hand to its owner. */
  const commit = (c: Ctx, auto = false, extra: LogEntry[] = []) => {
    const steps: CommitSteps<G, M> = {
      slug: game.slug,
      scheduleTurn: () => armTurnClock(c, false),
      logEvents: game.logEvents,
      noteMove: game.noteMove,
      roundResult: game.roundResult,
      buildReport: game.buildReport,
      view: () => viewOf(c),
      handOf: (playerId) => game.handOf(c.vars.game, playerId),
    }

    return commitRoom(c, ports(c), steps, auto, extra)
  }

  /** Starts the match; `by` must be the host. */
  const begin = (c: RoomCtx<G, M>, by: string | null) => {
    beginMatch(c, game.newMatch(), (rng) => game.startGame(c.vars.game, by, rng))
  }

  /** How a tournament table starts itself: as its host would. */
  const tournamentSteps = (c: Ctx) => ({
    start: () => begin(c, c.vars.game.hostId),
    commit: () => commit(c),
    seatBot: (id: string, name: string, seat: number | null) => {
      c.vars.game = apply(() => game.addPlayer(c.vars.game, id, name, true, seat ?? undefined))
    },
  })

  const kit: RoomKit<G, M, Action> = {
    move: (parse) => async (c, input) => {
      const me = requirePlayer(c)
      const action = parse(input)
      c.vars.game = withRng(c, (rng) => game.applyAction(c.vars.game, me, action, rng))
      await commit(c)
    },
  }

  return actor({
    options: { name: game.title, icon: game.icon },
    db: db({ onMigrate: migrateRoom }),
    createVars: () => roomVars<G, M>(game.createGame()),
    onWake: async (c: Ctx) => {
      const { platform, store } = ports(c)
      await loadRoom(c, store)

      if (game.upgrade) {
        c.vars.game = game.upgrade(c.vars.game)
        c.vars.logged = c.vars.game
      }

      // Re-arms the running turn and keeps the deadline players already saw.
      await armTurnClock(c, true)
      await resumeReports(c, store)
      await wakeTournament(c, platform)
    },
    onBeforeConnect: async (c: Ctx, params: unknown) => checkConnect(c, params, ports(c).platform),
    onConnect: async (c: Ctx, conn: Act['conn']) => {
      const roomPorts = ports(c)
      if (!(await identify(c, conn, roomPorts.platform))) {
        return
      }

      await reportToDirectory(c, roomPorts, game.slug)
      await armVipRefresh(c)
    },
    onDisconnect: async (c: Ctx, conn: Act['conn']) => {
      const id = playerOf(c, conn)
      delete c.vars.who[conn.id]

      await reportToDirectory(c, ports(c), game.slug, conn.id)
      if (id) {
        await c.schedule.after(GONE_AFTER_MS, 'dropIfGone', id)
      }
    },
    actions: {
      ...moves(kit),

      /** Joins (or rejoins) the room; returns your player id, the current view and your hand. */
      join: async (c: Act) => {
        const who = caller(c)
        const seated = c.vars.game.players.find((player) => player.id === who.id)

        if (!seated) {
          const seat = await seatFor(c, who, ports(c).platform)
          c.vars.game = apply(() => game.addPlayer(c.vars.game, who.id, who.name, false, seat))

          if (who.vip) {
            c.vars.game = markVip(c.vars.game, who.id)
          }

          c.vars.game = showAvatar(c.vars.game, who.id, who.avatar)
          await commit(c)

          // The last one in starts a tournament table.
          await tournamentTick(c, ports(c).platform, tournamentSteps(c))
        } else {
          // Back from a closed tab, maybe with a new look picked meanwhile.
          const back = seated.away ? markBack(c.vars.game, who.id) : c.vars.game
          const shown = showAvatar(back, who.id, who.avatar)
          if (shown !== c.vars.game) {
            c.vars.game = shown
            await commit(c)
          }
        }

        return {
          playerId: who.id,
          view: viewOf(c),
          hand: game.handOf(c.vars.game, who.id),
        }
      },

      leave: async (c: Act) => {
        c.vars.game = removePlayer(c.vars.game, requirePlayer(c))
        await commit(c)
      },

      /** Host only: seats a bot in the given empty chair. */
      addBot: async (c: Act, seatInput: unknown) => {
        requireOpenTable(c)
        requireHost(c)
        const seat = parseSeat(seatInput)
        const botId = `bot-${crypto.randomUUID()}`
        const name = botName(c.vars.game.players)

        c.vars.game = apply(() => game.addPlayer(c.vars.game, botId, name, true, seat))
        await commit(c)
      },

      /** Moves you to an empty chair (lobby only). */
      takeSeat: async (c: Act, seatInput: unknown) => {
        requireOpenTable(c)
        const me = requirePlayer(c)
        const seat = parseSeat(seatInput)
        c.vars.game = apply(() => takeSeat(c.vars.game, me, seat))
        await commit(c)
      },

      removeBot: async (c: Act, botId: unknown) => {
        requireOpenTable(c)
        requireHost(c)
        const id = BotIdInput.parse(botId)
        const bot = c.vars.game.players.find((player) => player.id === id)
        if (!bot?.bot) {
          throw new UserError('Bot not found.', { code: 'rule' })
        }

        c.vars.game = removePlayer(c.vars.game, id)
        await commit(c)
      },

      /** Host only, in the lobby: takes a player off the table; they can't come back to it. */
      kick: async (c: Act, seatInput: unknown) => {
        requireOpenTable(c)
        const hostId = requireHost(c)
        const seat = parseSeat(seatInput)

        const kick = kickFromTable(c, seat, { kind: 'host', hostId })
        await commit(c, false, kick.entries)
        await closeKicked(c, kick.result.playerId, currentTurn(c))
      },

      /** Backoffice only: kicks a player off the table, in the lobby or mid-game. */
      adminKick: async (c: Act, input: unknown) => {
        requireAdmin(c)
        const parsed = AdminKickInput.safeParse(input)
        if (!parsed.success) {
          throw new UserError('Pick a seat and give a reason.', { code: 'bad_input' })
        }

        const kick = kickFromTable(c, parsed.data.seat, {
          kind: 'admin',
          reason: parsed.data.reason,
        })
        await commit(c, false, kick.entries)
        await closeKicked(c, kick.result.playerId, currentTurn(c))

        return kick.result
      },

      /** Backoffice only: ends the table for good; a running match is saved as terminated. */
      adminTerminate: async (c: Act, input: unknown) => {
        requireAdmin(c)
        const parsed = AdminTerminateInput.safeParse(input)
        if (!parsed.success) {
          throw new UserError('Give a reason.', { code: 'bad_input' })
        }

        const termination = terminateTable(c, parsed.data.reason)
        await commit(c, false, termination.entries)
        await closeTerminated(c, termination.result, ports(c).platform)

        return termination.result
      },

      start: async (c: Act) => {
        requireOpenTable(c)
        begin(c, requirePlayer(c))
        await commit(c)
      },

      reset: async (c: Act) => {
        requireOpenTable(c)
        const me = requirePlayer(c)
        c.vars.game = apply(() => game.resetToLobby(c.vars.game, me))
        await commit(c)
      },

      /** Internal (scheduler only): a closed tab did not come back. */
      dropIfGone: async (c: Act, id: unknown) => {
        if (!scheduledWhileOpen(c)) {
          return
        }

        const dropped = await dropIfGone(c, id, currentTurn(c))
        if (dropped) {
          await commit(c)
        }
      },

      /** Internal (scheduler only): shows a VIP grant or revoke on a seated player's tag. */
      refreshVips: async (c: Act, at: unknown) => {
        if (!scheduledWhileOpen(c)) {
          return
        }

        const changed = await refreshVips(c, at, ports(c).platform)
        if (changed) {
          await commit(c)
        }
      },

      /** Internal (scheduler only): a tournament table's start time, or the end of its wait for late players. */
      tournamentStart: async (c: Act) => {
        if (!scheduledWhileOpen(c)) {
          return
        }

        await tournamentTick(c, ports(c).platform, tournamentSteps(c))
      },

      /** Internal (scheduler only): sends queued rounds and match results to the platform. */
      sendReports: async (c: Act) => {
        requireScheduler(c)
        await sendReports(c, ports(c))
      },

      /** Internal (scheduler only): moves for a bot, or for a human whose time ran out. */
      autoPlay: async (c: Act, key: unknown) => {
        if (!scheduledWhileOpen(c)) {
          return
        }

        const table = c.vars.game
        const turnKey = game.turnKey(table)

        // A stale or duplicate timer (e.g. after a wake) must not move twice.
        if (table.phase !== 'playing' || key !== turnKey) {
          return
        }

        const player = table.players[table.turn]
        if (!player) {
          return
        }

        const action = game.autoAction(table)
        if (action === null) {
          return
        }

        const next = withRng(c, (rng) => game.applyAction(table, player.id, action, rng))
        c.vars.game = player.bot ? next : game.markAuto(next)

        // The same turn may go on (after a draw): move again a moment later.
        const followUp = game.followUpMs?.(action) ?? null
        if (followUp !== null) {
          await c.schedule.after(followUp, 'autoPlay', turnKey)
        }

        await commit(c, true)
      },
    },
  })
}
