// A tournament's players, as an admin manages them: signing players up and out, seating them at a table that hasn't
// started, and disqualifying them.

import type { SQL } from 'bun'
import type { Admin } from './auth.ts'
import { audit } from './auth.ts'
import { refundSignUp } from './coins.ts'
import { isUuid } from './players.ts'
import { lockOpen, type PlayerStatus, TournamentError } from './tournaments.ts'

/** Most player ids one paste may register. */
export const REGISTER_MAX = 500

/** Longest reason a disqualification may give. */
export const REASON_MAX = 200

/** How many unknown ids an error message names before it cuts off. */
const UNKNOWN_IDS_SHOWN = 5

/** Player ids from a paste: one per line, or separated by commas or spaces. */
export function parseIds(text: string): { ids: string[]; invalid: string[] } {
  const parts = [...new Set(text.split(/[\s,]+/).filter(Boolean))]

  return {
    ids: parts.filter(isUuid).map((part) => part.toLowerCase()),
    invalid: parts.filter((part) => !isUuid(part)),
  }
}

/**
 * Registers players by id until the tables are handed out (admins aren't held to the sign-up window).
 * Returns how many were added; ids already in are skipped, unknown ones refuse the whole paste.
 */
export async function registerPlayers(
  sql: SQL,
  admin: Admin,
  id: string,
  ids: string[],
  ip: string | null,
): Promise<{ added: number; already: number }> {
  if (ids.length === 0) {
    throw new TournamentError('Paste at least one player id.')
  }

  if (ids.length > REGISTER_MAX) {
    throw new TournamentError(`Paste at most ${REGISTER_MAX} ids at a time.`)
  }

  return sql.begin(async (tx) => {
    const tournament = await lockOpen(tx, id)
    if (tournament.distributed_at) {
      throw new TournamentError(
        'Tables are already handed out. Add a player to a table below instead.',
      )
    }

    const knownRows = await tx`
			SELECT id
			FROM players
			WHERE id IN ${tx(ids)}`
    const known = new Set(knownRows.map((row: { id: string }) => row.id))

    const unknown = ids.filter((playerId) => !known.has(playerId))
    if (unknown.length > 0) {
      const shown = unknown.slice(0, UNKNOWN_IDS_SHOWN).join(', ')
      const more = unknown.length > UNKNOWN_IDS_SHOWN ? ', …' : ''
      throw new TournamentError(`Unknown player ids: ${shown}${more}`)
    }

    await requireFreePlaces(tx, id, tournament.max_players, ids)

    const rows = ids.map((playerId) => ({
      tournament_id: id,
      player_id: playerId,
      registered_by_admin_id: admin.id,
    }))

    const added = await tx`
			INSERT INTO tournament_players ${tx(rows)}
			ON CONFLICT DO NOTHING
			RETURNING player_id`

    if (added.length > 0) {
      await audit(tx, {
        adminId: admin.id,
        action: 'tournament.register',
        tournamentId: id,
        detail: { players: added.length },
        ip,
      })
    }

    return { added: added.length, already: ids.length - added.length }
  })
}

/**
 * Refuses a paste that would take the tournament past its most players; ids already in don't count. NULL takes
 * anyone. The caller holds the tournament row, so the count can't change under it.
 */
async function requireFreePlaces(
  tx: SQL,
  id: string,
  maxPlayers: number | null,
  ids: string[],
): Promise<void> {
  if (maxPlayers === null) {
    return
  }

  const [counts] = await tx`
		SELECT
			count(*) FILTER (WHERE status = 'registered')::int AS registered,
			count(*) FILTER (WHERE player_id IN ${tx(ids)})::int AS already
		FROM tournament_players
		WHERE tournament_id = ${id}`

  const free = Math.max(maxPlayers - counts.registered, 0)
  const adding = ids.length - counts.already

  if (adding > free) {
    throw new TournamentError(
      `Only ${free} of ${maxPlayers} places are left; this paste adds ${adding}.`,
    )
  }
}

/** Takes a player out, and off their table first. Refused once their table started. */
export async function unregisterPlayer(
  sql: SQL,
  admin: Admin,
  id: string,
  playerId: string,
  ip: string | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    await lockOpen(tx, id)

    // Once they played any round, their seats are history: disqualify them instead.
    const [seats] = await tx`
			SELECT coalesce(bool_or(r.started_at IS NOT NULL), false) AS played
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${id} AND ra.player_id = ${playerId}`

    if (seats.played) {
      throw new TournamentError('Their table already started.')
    }

    await tx`
			DELETE FROM room_assignments
			WHERE tournament_id = ${id} AND player_id = ${playerId}`

    // They never played, so any fee they paid goes back with the sign-up.
    await refundSignUp(tx, id, playerId)
    const [gone] = await tx`
			DELETE FROM tournament_players
			WHERE tournament_id = ${id} AND player_id = ${playerId}
			RETURNING player_id`

    if (!gone) {
      throw new TournamentError('That player is not registered.')
    }

    await audit(tx, {
      adminId: admin.id,
      action: 'tournament.unregister',
      tournamentId: id,
      playerId,
      ip,
    })
  })
}

/**
 * Seats a player at a table that hasn't started, on its first free seat. Registers them too if needed.
 * Nobody already seated is moved: a player at another table must be taken off it first.
 */
export async function assignPlayer(
  sql: SQL,
  admin: Admin,
  id: string,
  roomCode: string,
  playerId: string,
  ip: string | null,
): Promise<number> {
  return sql.begin(async (tx) => {
    const tournament = await lockOpen(tx, id)

    const [room] = await tx`
			SELECT id, tournament_round, started_at, closed_at
			FROM rooms
			WHERE code = ${roomCode} AND tournament_id = ${id}`

    if (!room) {
      throw new TournamentError('That table is not part of this tournament.')
    }

    if (room.started_at || room.closed_at) {
      throw new TournamentError('That table already started.')
    }

    const [player] = await tx`
			SELECT 1
			FROM players
			WHERE id = ${playerId}`
    if (!player) {
      throw new TournamentError('Unknown player id.')
    }

    const [signedUp] = await tx`
			SELECT status
			FROM tournament_players
			WHERE tournament_id = ${id} AND player_id = ${playerId}`

    if (signedUp && signedUp.status !== 'registered') {
      throw new TournamentError(`They ${outText(signedUp.status)} and can't play in it.`)
    }

    const [otherTable] = await tx`
			SELECT r.code
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${id}
				AND ra.tournament_round = ${room.tournament_round}
				AND ra.player_id = ${playerId}`

    if (otherTable) {
      throw new TournamentError(
        `They already sit at table ${otherTable.code}. Take them off it first.`,
      )
    }

    const seat = await firstFreeSeat(tx, room.id, tournament.players_per_room)
    if (seat === undefined) {
      throw new TournamentError('That table is full.')
    }

    await tx`
			INSERT INTO tournament_players (tournament_id, player_id, registered_by_admin_id)
			VALUES (${id}, ${playerId}, ${admin.id})
			ON CONFLICT DO NOTHING`

    await tx`
			INSERT INTO room_assignments (
				room_id,
				tournament_id,
				tournament_round,
				player_id,
				seat,
				assigned_by_admin_id
			)
			VALUES (
				${room.id},
				${id},
				${room.tournament_round},
				${playerId},
				${seat},
				${admin.id}
			)`

    await audit(tx, {
      adminId: admin.id,
      action: 'room.assign',
      tournamentId: id,
      roomId: room.id,
      playerId,
      detail: { seat },
      ip,
    })

    return seat
  })
}

/** The lowest seat number no one at the room holds, or undefined when the table is full. */
async function firstFreeSeat(
  tx: SQL,
  roomId: string,
  seatCount: number,
): Promise<number | undefined> {
  const rows = await tx`
		SELECT seat
		FROM room_assignments
		WHERE room_id = ${roomId}`
  const taken = new Set(rows.map((row: { seat: number | null }) => row.seat))
  const allSeats = Array.from({ length: seatCount }, (_, seat) => seat)

  return allSeats.find((seat) => !taken.has(seat))
}

/** Takes a player off a table that hasn't started. They stay registered. */
export async function unassignPlayer(
  sql: SQL,
  admin: Admin,
  id: string,
  playerId: string,
  ip: string | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    await lockOpen(tx, id)

    // Their seat in the latest round they were given one.
    const [seat] = await tx`
			SELECT ra.room_id, r.started_at
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${id} AND ra.player_id = ${playerId}
			ORDER BY ra.tournament_round DESC
			LIMIT 1`

    if (!seat) {
      throw new TournamentError('That player has no table.')
    }

    if (seat.started_at) {
      throw new TournamentError('Their table already started.')
    }

    await tx`
			DELETE FROM room_assignments
			WHERE room_id = ${seat.room_id} AND player_id = ${playerId}`

    await audit(tx, {
      adminId: admin.id,
      action: 'room.unassign',
      tournamentId: id,
      roomId: seat.room_id,
      playerId,
      ip,
    })
  })
}

const outText = (status: PlayerStatus) =>
  status === 'withdrawn'
    ? 'withdrew from this tournament'
    : 'were disqualified from this tournament'

/**
 * Puts a player out of the tournament for good, with a reason; they can't sign up or sit down again. At a table
 * that hasn't started their seat is freed, and the room drops them at the start if they already sat down. At a
 * running table the seat stays on record and the room won't let them back in; returns that table, since they may
 * still be playing at it.
 */
export async function disqualifyPlayer(
  sql: SQL,
  admin: Admin,
  id: string,
  target: { playerId: string; reason: string },
  ip: string | null,
): Promise<{ runningTable: string | null }> {
  const reason = target.reason.trim()
  if (!reason || reason.length > REASON_MAX) {
    throw new TournamentError(`Give a reason, up to ${REASON_MAX} characters.`)
  }

  return sql.begin(async (tx) => {
    const tournament = await lockOpen(tx, id)
    if (tournament.ended_at) {
      throw new TournamentError('This tournament already ended.')
    }

    const [player] = await tx`
			SELECT tp.status, latest.room_id, latest.code, latest.started_at, latest.closed_at
			FROM tournament_players tp
			-- Their seat in the latest round they were given one.
			LEFT JOIN LATERAL (
				SELECT r.id AS room_id, r.code, r.started_at, r.closed_at
				FROM room_assignments ra
				JOIN rooms r ON r.id = ra.room_id
				WHERE ra.tournament_id = tp.tournament_id AND ra.player_id = tp.player_id
				ORDER BY ra.tournament_round DESC
				LIMIT 1
			) latest ON true
			WHERE tp.tournament_id = ${id} AND tp.player_id = ${target.playerId}
			FOR UPDATE OF tp`

    if (!player) {
      throw new TournamentError('That player is not registered.')
    }

    if (player.status !== 'registered') {
      throw new TournamentError(`They already ${outText(player.status)}.`)
    }

    const running = !!player.started_at
    if (player.room_id && !running) {
      await tx`
				DELETE FROM room_assignments
				WHERE room_id = ${player.room_id} AND player_id = ${target.playerId}`
    }

    await tx`
			UPDATE tournament_players
			SET status = 'disqualified', status_reason = ${reason}, status_changed_at = now()
			WHERE tournament_id = ${id} AND player_id = ${target.playerId}`

    await audit(tx, {
      adminId: admin.id,
      action: 'tournament.disqualify',
      tournamentId: id,
      roomId: player.room_id,
      playerId: target.playerId,
      detail: { reason },
      ip,
    })

    return { runningTable: running && !player.closed_at ? player.code : null }
  })
}
