// Copy of the platform's "Distribute now" (distributeIn in apps/platform/src/services/tournaments.ts, with
// planRooms, spreadBots from tournament-bots.ts and the room code from rooms.ts). Change both together: the
// backoffice runs it for an admin and the platform's job runs it at the start time; the tournament row lock and
// distributed_at keep the two from both distributing.
import type { SQL } from 'bun'
import { must } from 'contracts/must'

/** No 0/O or 1/I, so a code read aloud or copied by hand stays right. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 32^8 ≈ 1.1 trillion codes, so with codes never reused a retry is still rare at 10 million rooms
 * and a random guess almost never hits a live table. Rooms made with shorter codes stay valid (4–8 chars).
 */
const CODE_LENGTH = 8
const CODE_TRIES = 5

/** 32 divides 256, so `byte % 32` has no bias. */
function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join('')
}

const newRoomCode = () => randomCode(CODE_LENGTH)

export class DistributeError extends Error {}

export interface DistributeBy {
  adminId: string | null
  ip?: string | null
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Splits players into ceil(n / perRoom) rooms, as evenly as possible (20 at 6 → 5+5+5+5).
 * Refuses when a room would fall below the game's minimum, and says how to fix it.
 */
function planRooms<T>(players: T[], perRoom: number, minPlayers: number): T[][] {
  const playerCount = players.length
  if (playerCount === 0) {
    throw new DistributeError('Nobody is registered.')
  }

  if (perRoom < minPlayers) {
    throw new DistributeError(`Players per table must be at least ${minPlayers}.`)
  }

  const roomCount = Math.ceil(playerCount / perRoom)
  const baseSize = Math.floor(playerCount / roomCount)

  if (baseSize < minPlayers) {
    const toAdd = roomCount * minPlayers - playerCount
    const toRemove = roomCount > 1 ? playerCount - (roomCount - 1) * perRoom : 0
    const removeHint = toRemove ? ` or remove ${toRemove}` : ''
    const fix = `Add ${plural(toAdd, 'player')}${removeHint}.`

    throw new DistributeError(
      `${plural(playerCount, 'player')} can't fill every table with at least ${minPlayers}. ${fix}`,
    )
  }

  // The first `bigRooms` rooms take one extra player each.
  const bigRooms = playerCount % roomCount
  const rooms: T[][] = []
  let start = 0

  for (let room = 0; room < roomCount; room++) {
    const size = room < bigRooms ? baseSize + 1 : baseSize
    rooms.push(players.slice(start, start + size))
    start += size
  }

  return rooms
}

/** Fisher-Yates shuffle with crypto randomness. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  const random = crypto.getRandomValues(new Uint32Array(out.length))

  for (let i = out.length - 1; i > 0; i--) {
    const j = must(random[i]) % (i + 1)
    ;[out[i], out[j]] = [must(out[j]), must(out[i])]
  }

  return out
}

/**
 * Spreads bots over the tables as evenly as they go (Erdin, 2026-11-14: no more than 2 bots at a table unless
 * there are too few people), keeping each table's size. Bots are dealt one per table in turn, then people fill
 * the seats left, in the order they came; so every table also gets a person while there are enough.
 */
function spreadBots(tables: string[][], isBot: (playerId: string) => boolean): string[][] {
  const everyone = tables.flat()
  const bots = everyone.filter((playerId) => isBot(playerId))
  const people = everyone.filter((playerId) => !isBot(playerId))
  const seats = tables.map((table) => ({ size: table.length, bots: 0 }))

  // Deal bots round the tables; a table keeps a seat for a person while people remain to take it.
  const keptForPeople = people.length > 0 ? 1 : 0
  let dealt = 0
  while (dealt < bots.length) {
    let placedThisPass = false

    for (const table of seats) {
      if (dealt < bots.length && table.bots < table.size - keptForPeople) {
        table.bots += 1
        dealt += 1
        placedThisPass = true
      }
    }

    // Every table kept its last seat for a person: those seats go to bots too.
    if (!placedThisPass) {
      for (const table of seats) {
        if (dealt < bots.length && table.bots < table.size) {
          table.bots += 1
          dealt += 1
        }
      }
    }
  }

  const botsLeft = [...bots]
  const peopleLeft = [...people]

  return seats.map(({ size, bots: botCount }) => {
    const table = botsLeft.splice(0, botCount)
    table.push(...peopleLeft.splice(0, size - table.length))
    table.push(...botsLeft.splice(0, size - table.length))

    return table
  })
}

/** Inserts a tournament table with a fresh code, retrying on the rare collision (see insertRoom in rooms.ts). */
async function insertTournamentRoom(
  tx: SQL,
  room: { game: string; tournamentId: string; tournamentRound: number; adminId: string | null },
): Promise<{ id: string }> {
  for (let i = 0; i < CODE_TRIES; i++) {
    const [row] = await tx`
			INSERT INTO rooms (
				game_slug,
				code,
				visibility,
				tournament_id,
				tournament_round,
				created_by_admin_id
			)
			VALUES (
				${room.game},
				${newRoomCode()},
				'private',
				${room.tournamentId},
				${room.tournamentRound},
				${room.adminId}
			)
			ON CONFLICT (code) DO NOTHING
			RETURNING id`

    if (row) {
      return { id: row.id }
    }
  }

  throw new Error(`no free room code after ${CODE_TRIES} tries`)
}

/**
 * Opens the tournament's rooms and seats every registered player, inside the caller's transaction.
 * Locks the tournament row first, so two runs (job and "Distribute now") never both distribute.
 */
export async function distributeIn(
  tx: SQL,
  tournamentId: string,
  by: DistributeBy,
): Promise<{ rooms: number; players: number }> {
  const [tournament] = await tx`
		SELECT
			t.game_slug,
			t.players_per_room,
			t.starts_at,
			t.min_players AS tournament_min,
			t.distributed_at,
			t.cancelled_at,
			g.min_players
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		WHERE t.id = ${tournamentId}
		FOR UPDATE OF t`

  if (!tournament) {
    throw new DistributeError('Tournament not found.')
  }

  if (tournament.cancelled_at) {
    throw new DistributeError('This tournament was cancelled.')
  }

  if (tournament.distributed_at) {
    throw new DistributeError('Players already have their tables.')
  }

  // Disabled and disqualified players can't play, so they don't take a seat.
  const registered = await tx`
		SELECT tp.player_id
		FROM tournament_players tp
		JOIN players p ON p.id = tp.player_id
		WHERE tp.tournament_id = ${tournamentId}
			AND tp.status = 'registered'
			AND p.disabled_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM room_assignments ra
				WHERE ra.tournament_id = tp.tournament_id AND ra.player_id = tp.player_id
			)`

  const playerIds = registered.map((row: { player_id: string }) => row.player_id)

  if (tournament.tournament_min !== null && playerIds.length < tournament.tournament_min) {
    throw new DistributeError(
      `It needs at least ${plural(tournament.tournament_min, 'player')}; ${playerIds.length} can play.`,
    )
  }

  const plan = planRooms<string>(
    shuffle(playerIds),
    tournament.players_per_room,
    tournament.min_players,
  )

  await seatRound(tx, {
    tournamentId,
    game: tournament.game_slug,
    round: 1,
    startsAt: tournament.starts_at,
    tables: plan,
    adminId: by.adminId,
  })

  await tx`
		UPDATE tournaments
		SET distributed_at = now(), distribute_error = NULL
		WHERE id = ${tournamentId}`

  const result = { rooms: plan.length, players: registered.length }
  const detail = JSON.stringify({ ...result, auto: !by.adminId })

  await tx`
		INSERT INTO admin_audit_events (admin_id, action, tournament_id, detail, ip)
		VALUES (
			${by.adminId},
			'tournament.distribute',
			${tournamentId},
			${detail}::text::jsonb,
			${by.ip ?? null}::inet
		)`

  return result
}

/** Writes a round, its tables and who sits where; each table starts by itself at `startsAt`. */
async function seatRound(
  tx: SQL,
  round: {
    tournamentId: string
    game: string
    round: number
    startsAt: Date
    tables: string[][]
    adminId: string | null
  },
): Promise<void> {
  // Bots spread over the tables, at most 2 a table while there are enough people, each table with a person.
  const everyone = round.tables.flat()
  const botRows =
    everyone.length > 0
      ? await tx`
				SELECT id
				FROM players
				WHERE is_bot AND id IN ${tx(everyone)}`
      : []
  const bots = new Set(botRows.map((row: { id: string }) => row.id))
  const tables = spreadBots(round.tables, (playerId) => bots.has(playerId))

  await tx`
		INSERT INTO tournament_rounds (tournament_id, round, starts_at)
		VALUES (${round.tournamentId}, ${round.round}, ${round.startsAt})`

  for (const tablePlayers of tables) {
    const room = await insertTournamentRoom(tx, {
      game: round.game,
      tournamentId: round.tournamentId,
      tournamentRound: round.round,
      adminId: round.adminId,
    })

    const assignments = tablePlayers.map((playerId, seat) => ({
      room_id: room.id,
      tournament_id: round.tournamentId,
      tournament_round: round.round,
      player_id: playerId,
      seat,
    }))
    await tx`INSERT INTO room_assignments ${tx(assignments)}`
  }
}
