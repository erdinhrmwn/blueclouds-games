import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { type Admin, createAdmin } from './auth';
import {
	assignPlayer,
	cancelTournament,
	createTournament,
	distributeNow,
	tournamentTables,
	parseIds,
	registerPlayers,
	tournamentDetail,
	unassignPlayer,
	unregisterPlayer
} from './tournaments';

let sql: SQL;
let admin: Admin;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
const players = async (n: number) =>
	(
		await sql`INSERT INTO players ${sql(Array.from({ length: n }, (_, i) => ({ display_name: `P${i}` })))} RETURNING id`
	).map((r: { id: string }) => r.id);
const newCup = (perRoom = 6) =>
	createTournament(
		sql,
		admin,
		{ game: 'bust-31', name: 'Friday Cup', playersPerRoom: perRoom, startsAt: inMinutes(60) },
		null
	);

beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	admin = {
		id: await createAdmin(sql, 'root', 'correct horse battery'),
		username: 'root',
		role: 'owner'
	};
});
afterAll(() => sql.close());

describe('tournaments', () => {
	test('create checks players per table against the game and defaults sign-up to now until 10 minutes before', async () => {
		await expect(
			createTournament(
				sql,
				admin,
				{ game: 'bust-31', name: 'Big', playersPerRoom: 7, startsAt: inMinutes(60) },
				null
			)
		).rejects.toThrow('2-6');
		await expect(
			createTournament(
				sql,
				admin,
				{ game: 'bust-31', name: 'Past', playersPerRoom: 6, startsAt: inMinutes(-1) },
				null
			)
		).rejects.toThrow('future');
		const id = await newCup();
		const { tournament } = (await tournamentDetail(sql, id))!;
		expect(inMinutes(60).getTime() - tournament.registrationClosesAt.getTime()).toBeLessThan(
			10 * 60_000 + 5_000
		);
		expect(tournament.registrationOpensAt.getTime()).toBeLessThanOrEqual(Date.now());
	});

	test('register by pasted ids, distribute now, then seat and take off by hand', async () => {
		const id = await newCup();
		const ids = await players(8);
		expect(parseIds(`${ids[0]}, ${ids[1]}\nnope`)).toEqual({
			ids: ids.slice(0, 2),
			invalid: ['nope']
		});
		expect(await registerPlayers(sql, admin, id, ids.slice(0, 7), null)).toEqual({
			added: 7,
			already: 0
		});
		expect(await registerPlayers(sql, admin, id, ids.slice(0, 2), null)).toEqual({
			added: 0,
			already: 2
		});
		await expect(registerPlayers(sql, admin, id, [crypto.randomUUID()], null)).rejects.toThrow(
			'Unknown player ids'
		);

		expect(await distributeNow(sql, admin, id, null)).toEqual({ rooms: 2, players: 7 });
		await expect(distributeNow(sql, admin, id, null)).rejects.toThrow('already have their tables');
		await expect(registerPlayers(sql, admin, id, [ids[7]!], null)).rejects.toThrow(
			'already handed out'
		);
		const tables = (await tournamentTables(sql)).filter((table) => table.tournamentId === id);
		expect(tables.map((table) => table.seats.length).sort()).toEqual([3, 4]);
		expect(tables[0]!.seats[0]).toEqual({
			playerId: expect.any(String),
			name: expect.any(String),
			seat: expect.any(Number)
		});

		const { tournament, rooms } = (await tournamentDetail(sql, id))!;
		expect(tournament.registrationClosesAt.getTime()).toBeLessThanOrEqual(Date.now());
		expect(rooms.map((r) => r.players).sort()).toEqual([3, 4]);

		const small = rooms.find((r) => r.players === 3)!;
		expect(await assignPlayer(sql, admin, id, small.code, ids[7]!, null)).toBe(3);
		await expect(assignPlayer(sql, admin, id, small.code, ids[0]!, null)).rejects.toThrow(
			'already sit at table'
		);
		await unassignPlayer(sql, admin, id, ids[7]!, null);
		await unregisterPlayer(sql, admin, id, ids[7]!, null);
		await sql`UPDATE rooms SET started_at = now() WHERE code = ${small.code}`;
		const seated = (await tournamentDetail(sql, id))!.players.find(
			(p) => p.roomCode === small.code
		)!;
		await expect(unregisterPlayer(sql, admin, id, seated.playerId, null)).rejects.toThrow(
			'already started'
		);

		const actions =
			await sql`SELECT action FROM admin_audit_events WHERE tournament_id = ${id} ORDER BY id`;
		expect(actions.map((a: { action: string }) => a.action)).toEqual([
			'tournament.create',
			'tournament.register',
			'tournament.distribute',
			'room.assign',
			'room.unassign',
			'tournament.unregister'
		]);
	});

	test('too few players is refused with the reason; cancel stops further changes', async () => {
		const id = await newCup(2);
		await registerPlayers(sql, admin, id, await players(3), null);
		await expect(distributeNow(sql, admin, id, null)).rejects.toThrow("can't fill every table");
		expect(
			(await tournamentDetail(sql, id))!.tournament.registrationClosesAt.getTime()
		).toBeGreaterThan(Date.now()); // rolled back
		await cancelTournament(sql, admin, id, null);
		await expect(cancelTournament(sql, admin, id, null)).rejects.toThrow(
			'already ended or was cancelled'
		);
		await expect(registerPlayers(sql, admin, id, await players(1), null)).rejects.toThrow(
			'cancelled'
		);
	});
});
