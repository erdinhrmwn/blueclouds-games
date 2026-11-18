import { fail, redirect } from '@sveltejs/kit'
import { auditIp } from '#lib/server/auth.ts'
import { sql } from '#lib/server/db.ts'
import { listGames } from '#lib/server/games.ts'
import {
  createTournament,
  listTournaments,
  NewTournament,
  prizeRows,
  TournamentError,
} from '#lib/server/tournaments.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const [tournaments, games] = await Promise.all([listTournaments(sql), listGames(sql)])

  return { tournaments, games }
}

export const actions: Actions = {
  create: async ({ request, locals, getClientAddress }) => {
    const data = await request.formData()
    const coins = data.getAll('prizeCoins').map(String)
    const extras = data.getAll('prizeExtra').map(String)
    const prizes = prizeRows(coins, extras)

    const entries = [...data.entries()]
      .filter(([key]) => key !== 'prizeCoins' && key !== 'prizeExtra')
      .map(([key, value]) => [key, String(value)])
    const values = Object.fromEntries(entries)

    // Empty fields count as left out, so their defaults apply.
    const filled = Object.fromEntries(entries.filter(([, value]) => value !== ''))
    const parsed = NewTournament.safeParse({ ...filled, prizes })

    if (!parsed.success) {
      const error = parsed.error.issues[0]?.message ?? 'Some fields are invalid.'
      return fail(400, { values, prizes, error })
    }

    let id: string
    try {
      id = await createTournament(sql, locals.admin!, parsed.data, auditIp(getClientAddress()))
    } catch (err) {
      if (err instanceof TournamentError) {
        return fail(400, { values, prizes, error: err.message })
      }

      throw err
    }

    redirect(303, `/tournaments/${id}`)
  },
}
