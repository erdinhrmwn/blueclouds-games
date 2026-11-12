import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DistributeError, planRooms, runTournamentJob } from "../services/tournaments";
import { call, guest, SERVER_KEY, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let admin: string;
beforeAll(async () => {
	t = await setupTestApp();
	[{ id: admin }] =
		await t.sql`INSERT INTO admins (username, password_hash) VALUES ('root', '$argon2id$v=19$test') RETURNING id`;
});
afterAll(() => t.sql.close());

/** A tournament whose times are minutes from now (negative = in the past). */
async function tournament(opts: {
	opens?: number;
	closes: number;
	starts: number;
	perRoom?: number;
	game?: string;
}) {
	const at = (min: number) => new Date(Date.now() + min * 60_000);
	const [row] = await t.sql`
		INSERT INTO tournaments (game_slug, name, players_per_room, starts_at, registration_opens_at, registration_closes_at, created_by_admin_id)
		VALUES (${opts.game ?? "bust-31"}, 'Friday Cup', ${opts.perRoom ?? 6}, ${at(opts.starts)}, ${at(opts.opens ?? -60)}, ${at(opts.closes)}, ${admin})
		RETURNING id`;
	return row.id as string;
}

async function register(tournamentId: string, n: number): Promise<string[]> {
	const rows = Array.from({ length: n }, (_, i) => ({ display_name: `P${i}` }));
	const players = await t.sql`INSERT INTO players ${t.sql(rows)} RETURNING id`;
	const ids = players.map((p: { id: string }) => p.id);
	await t.sql`INSERT INTO tournament_players ${t.sql(ids.map((player_id: string) => ({ tournament_id: tournamentId, player_id })))}`;
	return ids;
}

const sizes = (id: string) =>
	t.sql`SELECT r.code, count(ra.*)::int AS n FROM rooms r LEFT JOIN room_assignments ra ON ra.room_id = r.id WHERE r.tournament_id = ${id} GROUP BY r.code`.then(
		(rows) => rows.map((r: { n: number }) => r.n).sort(),
	);

const server = (method: string, path: string, body?: unknown) =>
	call(t.app, method, path, { token: SERVER_KEY, body });

describe("planRooms", () => {
	const people = (n: number) => Array.from({ length: n }, (_, i) => i);

	test("splits as evenly as possible", () => {
		expect(planRooms(people(20), 6, 2).map((r) => r.length)).toEqual([5, 5, 5, 5]);
		expect(planRooms(people(7), 6, 2).map((r) => r.length)).toEqual([4, 3]);
		expect(planRooms(people(6), 6, 2).map((r) => r.length)).toEqual([6]);
		expect(
			planRooms(people(20), 6, 2)
				.flat()
				.sort((a, b) => a - b),
		).toEqual(people(20));
	});

	test("refuses a table below the game's minimum and says how to fix it", () => {
		expect(() => planRooms(people(3), 2, 2)).toThrow(
			"3 players can't fill every table with at least 2. Add 1 player or remove 1.",
		);
		expect(() => planRooms(people(1), 6, 2)).toThrow("Add 1 player.");
		expect(() => planRooms([], 6, 2)).toThrow(DistributeError);
	});
});

describe("the distribute job", () => {
	test("distributes a due tournament once, even when two runs overlap", async () => {
		const id = await tournament({ closes: -1, starts: 10 });
		await register(id, 20);
		const runs = await Promise.all([runTournamentJob(t.sql), runTournamentJob(t.sql)]);
		expect(runs.reduce((n, r) => n + r.distributed, 0)).toBe(1);
		expect(await sizes(id)).toEqual([5, 5, 5, 5]);
		const before =
			await t.sql`SELECT room_id, player_id, seat FROM room_assignments WHERE tournament_id = ${id} ORDER BY player_id`;
		await runTournamentJob(t.sql);
		expect(
			await t.sql`SELECT room_id, player_id, seat FROM room_assignments WHERE tournament_id = ${id} ORDER BY player_id`,
		).toEqual(before);
		const [audit] =
			await t.sql`SELECT admin_id, detail FROM admin_audit_events WHERE tournament_id = ${id} AND action = 'tournament.distribute'`;
		expect(audit).toEqual({ admin_id: null, detail: { rooms: 4, players: 20, auto: true } });
	});

	test("too few players leaves the reason and retries; cancelled or not yet due ones are left alone", async () => {
		const short = await tournament({ closes: -1, starts: 10, perRoom: 2 });
		await register(short, 3);
		const cancelled = await tournament({ closes: -1, starts: 10 });
		await register(cancelled, 4);
		await t.sql`UPDATE tournaments SET cancelled_at = now() WHERE id = ${cancelled}`;
		const later = await tournament({ closes: 5, starts: 10 });
		await register(later, 4);

		await runTournamentJob(t.sql);
		const rows =
			await t.sql`SELECT id, distributed_at, distribute_error FROM tournaments WHERE id IN ${t.sql([short, cancelled, later])}`;
		const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
		expect(byId[short].distribute_error).toBe(
			"3 players can't fill every table with at least 2. Add 1 player or remove 1.",
		);
		expect(byId[short].distributed_at).toBeNull();
		expect(byId[cancelled].distributed_at).toBeNull();
		expect(byId[later].distributed_at).toBeNull();
		expect(await sizes(short)).toEqual([]);

		await register(short, 1); // the admin fixes it; the next tick goes through
		await runTournamentJob(t.sql);
		expect(await sizes(short)).toEqual([2, 2]);
	});

	test("closes a room nobody opened after starts_at + 4 min, never a started one, then ends the tournament", async () => {
		const id = await tournament({ opens: -60, closes: -10, starts: -5, perRoom: 2 });
		await register(id, 4);
		await runTournamentJob(t.sql); // distributes and, being past +4 min, closes both unopened rooms
		expect(
			(
				await t.sql`SELECT count(*)::int AS n FROM rooms WHERE tournament_id = ${id} AND close_reason = 'not_enough_players'`
			)[0].n,
		).toBe(2);
		expect(
			(await t.sql`SELECT ended_at FROM tournaments WHERE id = ${id}`)[0].ended_at,
		).not.toBeNull();

		const started = await tournament({ opens: -60, closes: -10, starts: -5 });
		await register(started, 2);
		await t.sql`UPDATE tournaments SET starts_at = now() + interval '10 min' WHERE id = ${started}`;
		await runTournamentJob(t.sql);
		await t.sql`UPDATE rooms SET started_at = now() WHERE tournament_id = ${started}`;
		await t.sql`UPDATE tournaments SET starts_at = now() - interval '5 min' WHERE id = ${started}`;
		expect((await runTournamentJob(t.sql)).closed).toBe(0);
	});
});

describe("sign-up", () => {
	test("only inside the registration window; joining twice is a no-op; leaving works", async () => {
		const open = await tournament({ closes: 5, starts: 15 });
		const early = await tournament({ opens: 5, closes: 10, starts: 15 });
		const closed = await tournament({ closes: -1, starts: 15 });
		const ann = await guest(t.app, "Ann");
		const join = (id: string) =>
			call(t.app, "POST", `/v1/tournaments/${id}/registration`, { token: ann.secret });

		expect((await join(open)).status).toBe(200);
		expect((await join(open)).status).toBe(200);
		expect((await join(early)).status).toBe(409);
		expect((await join(closed)).json.error.message).toBe(
			"Registration for this tournament is closed.",
		);
		expect(
			(
				await call(t.app, "POST", `/v1/tournaments/${crypto.randomUUID()}/registration`, {
					token: ann.secret,
				})
			).status,
		).toBe(404);

		const list = await call(t.app, "GET", "/v1/tournaments?game=bust-31", { token: ann.secret });
		const mine = list.json.data.tournaments.find((x: { id: string }) => x.id === open);
		expect(mine).toMatchObject({
			name: "Friday Cup",
			registered: 1,
			joined: true,
			playersPerRoom: 6,
		});
		expect(
			list.json.data.tournaments.some((x: { id: string }) => x.id === early || x.id === closed),
		).toBe(false);

		expect(
			(await call(t.app, "DELETE", `/v1/tournaments/${open}/registration`, { token: ann.secret }))
				.status,
		).toBe(200);
		expect(
			(
				await t.sql`SELECT count(*)::int AS n FROM tournament_players WHERE tournament_id = ${open}`
			)[0].n,
		).toBe(0);
	});
});

describe("tournament rooms", () => {
	let id: string;
	let ann: Awaited<ReturnType<typeof guest>>;
	let ben: Awaited<ReturnType<typeof guest>>;
	let code: string;

	beforeAll(async () => {
		id = await tournament({ closes: -1, starts: 10, perRoom: 2 });
		ann = await guest(t.app, "Ann");
		ben = await guest(t.app, "Ben");
		await t.sql`INSERT INTO tournament_players ${t.sql([ann, ben].map((p) => ({ tournament_id: id, player_id: p.player.id })))}`;
		await runTournamentJob(t.sql);
		[{ code }] = await t.sql`SELECT code FROM rooms WHERE tournament_id = ${id}`;
	});

	test("the assigned player sees their table and may enter; an outsider may not", async () => {
		const rooms = await call(t.app, "GET", "/v1/players/me/rooms?game=bust-31", {
			token: ann.secret,
		});
		expect(rooms.json.data.rooms).toEqual([
			{
				code,
				game: "bust-31",
				seat: expect.any(Number),
				tournament: { id, name: "Friday Cup", startsAt: expect.any(String) },
			},
		]);
		const enter = await call(t.app, "GET", `/v1/rooms/${code}`, { token: ann.secret });
		expect(enter.json.data.room.tournament.name).toBe("Friday Cup");
		const outsider = await guest(t.app, "Cy");
		const refused = await call(t.app, "GET", `/v1/rooms/${code}`, { token: outsider.secret });
		expect(refused.status).toBe(403);
		expect(refused.json.error.message).toBe("This table is for players of Friday Cup.");
		const share = await call(t.app, "POST", `/v1/rooms/${code}/invites`, {
			token: ann.secret,
			body: { kind: "link" },
		});
		expect(share.status).toBe(403);
	});

	test("the actor reads its seats with the server key only", async () => {
		expect(
			(await call(t.app, "GET", `/v1/rooms/${code}/seats`, { token: ann.secret })).status,
		).toBe(401);
		const res = await server("GET", `/v1/rooms/${code}/seats`);
		expect(res.json.data.room).toMatchObject({
			code,
			game: "bust-31",
			visibility: "private",
			minPlayers: 2,
			startedAt: null,
			tournament: { id, cancelled: false },
		});
		expect(res.json.data.room.seats.map((s: { seat: number }) => s.seat)).toEqual([0, 1]);
		expect((await server("GET", "/v1/rooms/ZZZZZ/seats")).status).toBe(404);
	});

	test("start, then the match report closes the room and ends the tournament", async () => {
		expect((await server("POST", `/v1/rooms/${code}/start`)).status).toBe(200);
		const now = new Date().toISOString();
		const report = {
			matchId: "01900000-0000-7000-8000-0000000000aa",
			game: "bust-31",
			roomCode: code,
			rulesVersion: 1,
			startedAt: now,
			endedAt: now,
			players: [
				{ seat: 0, playerId: ann.player.id, bot: false, placement: 1, score: 2 },
				{ seat: 1, playerId: ben.player.id, bot: false, placement: 2, score: 0 },
			],
			log: { logVersion: 1, events: [{ seq: 0, t: 0, type: "started" }] },
		};
		expect((await server("POST", "/v1/matches", report)).status).toBe(201);
		const [room] = await t.sql`SELECT started_at, close_reason FROM rooms WHERE code = ${code}`;
		expect(room.close_reason).toBe("finished");
		expect(room.started_at).not.toBeNull();
		expect(
			(await t.sql`SELECT ended_at FROM tournaments WHERE id = ${id}`)[0].ended_at,
		).not.toBeNull();
		expect((await call(t.app, "GET", `/v1/rooms/${code}`, { token: ann.secret })).status).toBe(200); // to see how it ended
		expect(
			(await call(t.app, "GET", "/v1/players/me/rooms", { token: ann.secret })).json.data.rooms,
		).toEqual([]);
	});

	test("a room that gives up closes as not_enough_players; a cancelled tournament's room refuses everyone", async () => {
		const other = await tournament({ closes: -1, starts: 10, perRoom: 2 });
		await t.sql`INSERT INTO tournament_players ${t.sql([ann, ben].map((p) => ({ tournament_id: other, player_id: p.player.id })))}`;
		await runTournamentJob(t.sql);
		const [{ code: c2 }] = await t.sql`SELECT code FROM rooms WHERE tournament_id = ${other}`;
		expect((await server("POST", `/v1/rooms/${c2}/close`, { reason: "finished" })).status).toBe(
			400,
		);
		expect(
			(await server("POST", `/v1/rooms/${c2}/close`, { reason: "not_enough_players" })).status,
		).toBe(200);
		expect((await t.sql`SELECT close_reason FROM rooms WHERE code = ${c2}`)[0].close_reason).toBe(
			"not_enough_players",
		);

		await t.sql`UPDATE tournaments SET cancelled_at = now() WHERE id = ${other}`;
		expect(
			(await call(t.app, "GET", `/v1/rooms/${c2}`, { token: ann.secret })).json.error.message,
		).toBe("Friday Cup was cancelled.");
	});
});
