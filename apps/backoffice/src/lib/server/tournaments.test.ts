import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { type Admin, createAdmin } from './auth';
import {
	assignPlayer,
	cancelTournament,
	createTournament,
	disqualifyPlayer,
	distributeNow,
	NewTournament,
	prizeRows,
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
const newCup = (perRoom = 6, maxPlayers = 36, minPlayers = 2) =>
	createTournament(
		sql,
		admin,
		{
			game: 'bust-31',
			name: 'Friday Cup',
			playersPerRoom: perRoom,
			minPlayers,
			maxPlayers,
			format: 'arena',
			description: null,
			prizes: [],
			fee: 0,
			startsAt: inMinutes(60)
		},
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
				{
					game: 'bust-31',
					name: 'Big',
					playersPerRoom: 7,
					minPlayers: 2,
					maxPlayers: 36,
					format: 'arena',
					description: null,
					prizes: [],
					fee: 0,
					startsAt: inMinutes(60)
				},
				null
			)
		).rejects.toThrow('2-6');
		await expect(
			createTournament(
				sql,
				admin,
				{
					game: 'bust-31',
					name: 'Past',
					playersPerRoom: 6,
					minPlayers: 2,
					maxPlayers: 36,
					format: 'arena',
					description: null,
					prizes: [],
					fee: 0,
					startsAt: inMinutes(-1)
				},
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

	test('most players is at least a table, and a paste past it is refused whole', async () => {
		await expect(newCup(6, 5)).rejects.toThrow('at least the players per table');
		await expect(newCup(6, 36, 1)).rejects.toThrow('Fewest players must be 2-36');
		await expect(newCup(6, 36, 37)).rejects.toThrow('Fewest players must be 2-36');

		const id = await newCup(2, 3);
		const ids = await players(4);
		await registerPlayers(sql, admin, id, ids.slice(0, 2), null);

		await expect(registerPlayers(sql, admin, id, ids.slice(1, 4), null)).rejects.toThrow(
			'Only 1 of 3 places are left; this paste adds 2.'
		);
		expect(await registerPlayers(sql, admin, id, ids.slice(1, 3), null)).toEqual({
			added: 1,
			already: 1
		});

		const { tournament } = (await tournamentDetail(sql, id))!;
		expect(tournament).toMatchObject({ registered: 3, maxPlayers: 3 });
	});

	test('format, description, prizes by place and fee are kept; the fee is whole coins', async () => {
		const form = {
			game: 'bust-31',
			name: 'Cup',
			playersPerRoom: '6',
			minPlayers: '2',
			maxPlayers: '12',
			format: 'swiss',
			description: ' Five rounds. ',
			prizes: prizeRows(['2000', '', ' ', '500'], ['Night Owl badge', 'Mug', '', '']),
			fee: '250',
			startsAt: '2099-01-01T20:00'
		};
		expect(NewTournament.safeParse({ ...form, format: 'bracket' }).success).toBe(false);
		expect(NewTournament.safeParse({ ...form, fee: '2.5' }).success).toBe(false);
		expect(NewTournament.safeParse({ ...form, fee: '-1' }).success).toBe(false);

		const { fee: _fee, ...withoutFee } = form;
		expect(NewTournament.parse(withoutFee).fee).toBe(0);

		const parsed = NewTournament.parse(form);
		const id = await createTournament(sql, admin, parsed, null);
		const { tournament } = (await tournamentDetail(sql, id))!;

		expect(tournament).toMatchObject({
			format: 'swiss',
			description: 'Five rounds.',
			prizes: [
				{ place: 1, coins: 2000, extra: 'Night Owl badge' },
				{ place: 2, coins: 0, extra: 'Mug' },
				{ place: 3, coins: 500, extra: null }
			],
			fee: 250
		});
	});

	test('a later round: detail shows tables by round, seats there, and the results; take off frees only that seat', async () => {
		const id = await newCup(2, 36, 2);
		const ids = await players(4);
		await registerPlayers(sql, admin, id, ids, null);
		await distributeNow(sql, admin, id, null);

		await sql`INSERT INTO tournament_rounds (tournament_id, round, starts_at) VALUES (${id}, 2, now() + interval '3 min')`;
		const [{ id: final }] = await sql`
			INSERT INTO rooms (game_slug, code, tournament_id, tournament_round)
			VALUES ('bust-31', 'FINAL1', ${id}, 2)
			RETURNING id`;
		await sql`
			INSERT INTO room_assignments (room_id, tournament_id, tournament_round, player_id, seat)
			VALUES (${final}, ${id}, 2, ${ids[0]}, 0), (${final}, ${id}, 2, ${ids[1]}, 1)`;
		await sql`
			INSERT INTO tournament_results (tournament_id, player_id, place, wins, last_round)
			VALUES (${id}, ${ids[0]}, 1, 2, 2), (${id}, ${ids[1]}, 2, 1, 2)`;

		const detail = (await tournamentDetail(sql, id))!;
		expect(detail.rooms.map((room) => room.round)).toEqual([2, 1, 1]);
		expect(detail.rooms[0]!.seats).toEqual([
			{ playerId: ids[0], seat: 0 },
			{ playerId: ids[1], seat: 1 }
		]);
		expect(detail.players.find((p) => p.playerId === ids[0])!.roomCode).toBe('FINAL1');
		expect(detail.results.map((result) => [result.place, result.playerId])).toEqual([
			[1, ids[0]],
			[2, ids[1]]
		]);

		await unassignPlayer(sql, admin, id, ids[0]!, null);
		const [{ seats }] = await sql`
			SELECT count(*)::int AS seats FROM room_assignments WHERE tournament_id = ${id} AND player_id = ${ids[0]}`;
		expect(seats).toBe(1);
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

	test('disqualify frees a waiting seat, keeps a running one on record, and is audited', async () => {
		const id = await newCup(2);
		const ids = await players(4);
		await registerPlayers(sql, admin, id, ids, null);
		await distributeNow(sql, admin, id, null);
		const before = (await tournamentDetail(sql, id))!;
		const [waitingRoom, runningRoom] = before.rooms;
		await sql`UPDATE rooms SET started_at = now() WHERE code = ${runningRoom!.code}`;
		const at = (code: string) => before.players.filter((p) => p.roomCode === code);
		const waiter = at(waitingRoom!.code)[0]!.playerId;
		const runner = at(runningRoom!.code)[0]!.playerId;

		await expect(
			disqualifyPlayer(sql, admin, id, { playerId: waiter, reason: '  ' }, null)
		).rejects.toThrow('Give a reason');
		expect(
			await disqualifyPlayer(sql, admin, id, { playerId: waiter, reason: 'Cheating' }, null)
		).toEqual({ runningTable: null });
		expect(
			await disqualifyPlayer(sql, admin, id, { playerId: runner, reason: 'Abuse' }, null)
		).toEqual({ runningTable: runningRoom!.code });
		await expect(
			disqualifyPlayer(sql, admin, id, { playerId: waiter, reason: 'Again' }, null)
		).rejects.toThrow('already were disqualified');

		const after = (await tournamentDetail(sql, id))!;
		const byId = new Map(after.players.map((p) => [p.playerId, p]));
		expect(byId.get(waiter)).toMatchObject({
			status: 'disqualified',
			statusReason: 'Cheating',
			roomCode: null
		});
		expect(byId.get(runner)).toMatchObject({ status: 'disqualified', roomCode: runningRoom!.code });
		expect(after.tournament.registered).toBe(2);
		await expect(assignPlayer(sql, admin, id, waitingRoom!.code, waiter, null)).rejects.toThrow(
			'were disqualified'
		);

		const [audit] = await sql`
			SELECT player_id, detail FROM admin_audit_events
			WHERE tournament_id = ${id} AND action = 'tournament.disqualify'
			ORDER BY id
			LIMIT 1`;
		expect(audit).toMatchObject({ player_id: waiter, detail: { reason: 'Cheating' } });
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
