// Paying a finished tournament's prizes out, once.

import type { SQL } from 'bun'
import type { Admin } from './auth.ts'
import { audit } from './auth.ts'
import { moveCoins } from './coins.ts'
import { plannedPayouts, TournamentError } from './tournaments.ts'

/**
 * Pays every prize of a finished tournament into its winners' wallets, once (Erdin, 2026-11-13: an admin
 * approves the payout). Places with only an extra (a badge) pay no coins.
 */
export async function payPrizes(
  sql: SQL,
  admin: Admin,
  id: string,
  ip: string | null,
): Promise<{ players: number; coins: number }> {
  return sql.begin(async (tx) => {
    const [tournament] = await tx`
			SELECT ended_at, cancelled_at, prizes_paid_at
			FROM tournaments
			WHERE id = ${id}
			FOR UPDATE`

    if (!tournament) {
      throw new TournamentError('This tournament no longer exists.')
    }

    if (tournament.cancelled_at) {
      throw new TournamentError('This tournament was cancelled.')
    }

    if (!tournament.ended_at) {
      throw new TournamentError('Prizes are paid once the tournament has finished.')
    }

    if (tournament.prizes_paid_at) {
      throw new TournamentError('The prizes were already paid.')
    }

    const payouts = (await plannedPayouts(tx, id)).filter((payout) => payout.coins > 0)
    for (const payout of payouts) {
      await moveCoins(tx, {
        playerId: payout.playerId,
        amount: payout.coins,
        reason: 'tournament_prize',
        tournamentId: id,
        adminId: admin.id,
      })
    }

    await tx`
			UPDATE tournaments
			SET prizes_paid_at = now(), prizes_paid_by_admin_id = ${admin.id}
			WHERE id = ${id}`

    const total = payouts.reduce((sum, payout) => sum + payout.coins, 0)
    await audit(tx, {
      adminId: admin.id,
      action: 'tournament.payout',
      tournamentId: id,
      detail: { players: payouts.length, coins: total },
      ip,
    })

    return { players: payouts.length, coins: total }
  })
}
