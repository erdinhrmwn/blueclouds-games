import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { balanceOf, moveCoins } from '../../../../platform/src/services/coins';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { type Admin, createAdmin } from './auth';
import { adjustCoins } from './players';
import { cancelTournament, payPrizes, plannedPayouts } from './tournaments';

let sql: SQL;
let admin: Admin;

beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	admin = {
		id: await createAdmin(sql, 'root', 'correct horse battery'),
		username: 'root',
		role: 'owner'
	};
});
afterAll(() => sql.close());

const newPlayer = async (name: string) =>
	(await sql`INSERT INTO players (display_name) VALUES (${name}) RETURNING id`)[0].id as string;

async function cup(opts: { ended?: boolean } = {}) {
	const [row] = await sql`
		INSERT INTO tournaments (
			game_slug, name, players_per_room, fee, starts_at, registration_opens_at, registration_closes_at,
			ended_at, created_by_admin_id
		)
		VALUES (
			'bust-31', 'Coin Cup', 2, 100, now() - interval '1 hour', now() - interval '3 hours',
			now() - interval '2 hours', ${opts.ended ? new Date() : null}, ${admin.id}
		)
		RETURNING id`;
	return row.id as string;
}

describe('coins in the backoffice', () => {
	test('an admin adds and takes coins with a note, never below zero, audited', async () => {
		const rina = await newPlayer('Rina');

		expect(await adjustCoins(sql, admin, rina, 500, 'Launch gift', null)).toBe(500);
		expect(await adjustCoins(sql, admin, rina, -200, 'Mistake', null)).toBe(300);
		await expect(adjustCoins(sql, admin, rina, -301, 'Too much', null)).rejects.toThrow(
			'They only have 300 coins.'
		);

		const [{ n }] =
			await sql`SELECT count(*)::int AS n FROM admin_audit_events WHERE action = 'player.coins_adjust' AND player_id = ${rina}`;
		expect(n).toBe(2);
	});

	test('cancelling gives every fee back except a disqualified player’s', async () => {
		const id = await cup();
		const sky = await newPlayer('Sky');
		await adjustCoins(sql, admin, sky, 100, 'For the fee', null);
		await sql.begin(async (tx) => {
			await tx`INSERT INTO tournament_players (tournament_id, player_id, fee_paid) VALUES (${id}, ${sky}, 100)`;
			await moveCoins(tx, {
				playerId: sky,
				amount: -100,
				reason: 'tournament_fee',
				tournamentId: id
			});
		});
		expect(await balanceOf(sql, sky)).toBe(0);

		const cheat = await newPlayer('Cheat');
		await adjustCoins(sql, admin, cheat, 100, 'For the fee', null);
		await sql.begin(async (tx) => {
			await tx`
				INSERT INTO tournament_players (tournament_id, player_id, fee_paid, status, status_reason, status_changed_at)
				VALUES (${id}, ${cheat}, 100, 'disqualified', 'Cheating', now())`;
			await moveCoins(tx, {
				playerId: cheat,
				amount: -100,
				reason: 'tournament_fee',
				tournamentId: id
			});
		});

		await cancelTournament(sql, admin, id, null);
		expect(await balanceOf(sql, sky)).toBe(100);
		// A disqualified player's fee is kept.
		expect(await balanceOf(sql, cheat)).toBe(0);
	});

	test('prizes go out once, to whoever finished in each paid place, only after the end', async () => {
		const running = await cup();
		await expect(payPrizes(sql, admin, running, null)).rejects.toThrow(
			'once the tournament has finished'
		);

		const id = await cup({ ended: true });
		const [ann, bob] = [await newPlayer('Ann'), await newPlayer('Bob')];
		await sql`INSERT INTO tournament_players ${sql([ann, bob].map((player_id) => ({ tournament_id: id, player_id })))}`;
		await sql`
			INSERT INTO tournament_results (tournament_id, player_id, place, wins, last_round)
			VALUES (${id}, ${ann}, 1, 2, 2), (${id}, ${bob}, 2, 1, 2)`;
		await sql`
			INSERT INTO tournament_prizes (tournament_id, place, coins, extra)
			VALUES (${id}, 1, 2000, 'Badge'), (${id}, 2, 1000, NULL), (${id}, 3, 500, NULL)`;

		expect(
			(await plannedPayouts(sql, id)).map((payout) => [payout.place, payout.playerId])
		).toEqual([
			[1, ann],
			[2, bob]
		]);

		expect(await payPrizes(sql, admin, id, null)).toEqual({ players: 2, coins: 3000 });
		expect(await balanceOf(sql, ann)).toBe(2000);
		expect(await balanceOf(sql, bob)).toBe(1000);
		await expect(payPrizes(sql, admin, id, null)).rejects.toThrow('already paid');
		expect(await balanceOf(sql, ann)).toBe(2000);
	});
});
