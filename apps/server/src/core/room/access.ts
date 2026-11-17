// Layer 3, room: who may connect and call what. Players come in with a play token, the backoffice with the engine's
// admin token, the scheduler with neither.

import { createHash, timingSafeEqual } from 'node:crypto'
import { TABLE_CLOSED } from 'contracts/rooms/room'
import { UserError } from 'rivetkit'
import type { PlatformPort } from '../domain/ports'
import type { Identity } from '../domain/room'
import { RuleError } from '../domain/table'
import type { ActionCtx, RoomConn, RoomCtx } from './context'
import { AdminParams, PlayerParams, SeatInput } from './inputs'

export const TERMINATED_MESSAGE = 'An admin closed this table.'
export const KICKED_MESSAGE = 'You were removed from this table.'
const EXPIRED_MESSAGE = 'Your session expired. Reload the page.'

const sha256 = (text: string) => createHash('sha256').update(text).digest()

/** Turns rule violations into errors the client is allowed to see. */
export function apply<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof RuleError) {
      throw new UserError(err.message, { code: 'rule' })
    }

    throw err
  }
}

export function parseSeat(input: unknown): number {
  const parsed = SeatInput.safeParse(input)
  if (!parsed.success) {
    throw new UserError('That seat does not exist.', { code: 'bad_input' })
  }

  return parsed.data
}

/**
 * Whether `key` is the engine's admin token, which only our servers hold (the backoffice uses it for admin
 * actions). Hashed first, so the comparison takes the same time whatever the length. No token set: never.
 */
function isAdminKey(key: string): boolean {
  const expected = process.env.RIVET_TOKEN
  if (!expected) {
    return false
  }

  return timingSafeEqual(sha256(key), sha256(expected))
}

/** The connection is the backoffice, with the admin token. */
function isAdminConn(conn: RoomConn | undefined): boolean {
  const parsed = AdminParams.safeParse(conn?.params)

  return parsed.success && isAdminKey(parsed.data.adminKey)
}

/** Throws when an admin terminated the table, or kicked this player off it. */
function refuseIfClosed(c: RoomCtx, playerId: string): void {
  if (c.vars.terminated) {
    throw new UserError(TERMINATED_MESSAGE, { code: TABLE_CLOSED })
  }

  if (c.vars.kicked.includes(playerId)) {
    throw new UserError(KICKED_MESSAGE, { code: TABLE_CLOSED })
  }
}

/** Who a play token in connection params belongs to; null when there is none or it isn't valid. */
async function identityOf(params: unknown, platform: PlatformPort): Promise<Identity | null> {
  const player = PlayerParams.safeParse(params)
  if (!player.success) {
    return null
  }

  return platform.verifyPlayToken(player.data.playToken)
}

/**
 * onBeforeConnect: only connections with a valid play token get in, or the backoffice with the admin token.
 * A terminated table, or one the player was kicked from, refuses them.
 */
export async function checkConnect(
  c: RoomCtx,
  params: unknown,
  platform: PlatformPort,
): Promise<void> {
  const admin = AdminParams.safeParse(params)
  if (admin.success) {
    if (isAdminKey(admin.data.adminKey)) {
      return
    }

    throw new UserError('Not allowed.', { code: 'forbidden' })
  }

  const identity = await identityOf(params, platform)
  if (!identity) {
    throw new UserError(EXPIRED_MESSAGE, { code: 'unauthenticated' })
  }

  refuseIfClosed(c, identity.id)
}

/**
 * onConnect: remembers who the connection is. Checked again because onBeforeConnect can't hand its result over.
 * Returns true for a player; the backoffice's connection is not one (it sits nowhere and gets no updates).
 */
export async function identify(
  c: RoomCtx,
  conn: RoomConn,
  platform: PlatformPort,
): Promise<boolean> {
  if (isAdminConn(conn)) {
    return false
  }

  const who = await identityOf(conn.params, platform)
  if (!who) {
    conn.disconnect('unauthenticated')
    return false
  }

  c.vars.who[conn.id] = who
  return true
}

/** The identity of the connection calling an action. Refused at a closed table. */
export function caller(c: ActionCtx): Identity {
  const who = c.vars.who[c.conn.id]
  if (!who) {
    throw new UserError(EXPIRED_MESSAGE, { code: 'unauthenticated' })
  }

  refuseIfClosed(c, who.id)
  return who
}

/** For the backoffice's actions: the connection must carry the admin token. */
export function requireAdmin(c: ActionCtx): void {
  if (!isAdminConn(c.conn)) {
    throw new UserError('Not allowed.', { code: 'forbidden' })
  }
}

/** The player a connection sits as, if they joined the table. */
export function playerOf(c: RoomCtx, conn: RoomConn): string | undefined {
  const id = c.vars.who[conn.id]?.id
  if (!id) {
    return undefined
  }

  const seated = c.vars.game.players.some((player) => player.id === id)
  return seated ? id : undefined
}

export function requirePlayer(c: ActionCtx): string {
  const id = playerOf(c, c.conn)
  if (!id) {
    throw new UserError('Join the table first.', { code: 'not_joined' })
  }

  refuseIfClosed(c, id)
  return id
}

export function requireHost(c: ActionCtx): string {
  const me = requirePlayer(c)
  if (c.vars.game.hostId !== me) {
    throw new UserError('Only the host can do that.', { code: 'rule' })
  }

  return me
}

export function requireScheduler(c: ActionCtx): void {
  if (!c.scheduledFire) {
    throw new UserError('Not allowed.', { code: 'forbidden' })
  }
}

/** For scheduled game steps (turns, drops, starts, VIP tags): false once an admin terminated the table. */
export function scheduledWhileOpen(c: ActionCtx): boolean {
  requireScheduler(c)

  return !c.vars.terminated
}

/** Host controls (bots, seats, start, play again) are for open tables; a tournament table runs itself. */
export function requireOpenTable(c: RoomCtx): void {
  if (c.vars.tournament) {
    throw new UserError('A tournament table starts on its own.', { code: 'rule' })
  }
}
