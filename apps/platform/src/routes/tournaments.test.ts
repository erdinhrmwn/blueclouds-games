import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DistributeError, planRooms, runTournamentJob } from "../services/tournaments";
import { call, guest, SERVER_KEY, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let admin: string;
beforeAll(async () => {
	t = await setupTestApp();
	[{ id: admin }] =
		await t.sql`INSERT INTO admins (username, password_hash, role) VALUES ('root', '$argon2id$v=19$test', 'owner') RETURNING id`;
});
afterAll(() => t.sql.close());

/** A tournament whose times are minutes from now (negative = in the past). */
async function tournament(opts: {
	opens?: number;
	closes: number;
	starts: number;
	perRoom?: number;
	min?: number;
	max?: number;
	format?: "arena" | "knockout" | "swiss";
	rounds?: number;
	game?: string;
}) {
	const at = (min: number) => new Date(Date.now() + min * 60_000);
	const [row] = await t.sql`
		INSERT INTO tournaments (game_slug, name, players_per_room, min_players, max_players, format, rounds, starts_at, registration_opens_at, registration_closes_at, created_by_admin_id)
		VALUES (${opts.game ?? "bust-31"}, 'Friday Cup', ${opts.perRoom ?? 6}, ${opts.min ?? null}, ${opts.max ?? null}, ${opts.format ?? null}, ${opts.rounds ?? null}, ${at(opts.starts)}, ${at(opts.opens ?? -60)}, ${at(opts.closes)}, ${admin})
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

	test("cancels one that closed below its minimum, audited with no admin; one that reached it is handed out", async () => {
		const short = await tournament({ closes: -1, starts: 10, perRoom: 2, min: 4 });
		await register(short, 3);
		const enough = await tournament({ closes: -1, starts: 10, perRoom: 2, min: 4 });
		await register(enough, 4);

		const run = await runTournamentJob(t.sql);
		expect(run.cancelled).toBeGreaterThanOrEqual(1);

		const [cancelled] =
			await t.sql`SELECT cancelled_at, cancel_reason, distributed_at FROM tournaments WHERE id = ${short}`;
		expect(cancelled.cancelled_at).toBeInstanceOf(Date);
		expect(cancelled.cancel_reason).toBe("Only 3 of the 4 players needed signed up.");
		expect(cancelled.distributed_at).toBeNull();
		expect(await sizes(short)).toEqual([]);

		const [audit] =
			await t.sql`SELECT admin_id, detail FROM admin_audit_events WHERE tournament_id = ${short} AND action = 'tournament.cancel'`;
		expect(audit).toEqual({ admin_id: null, detail: { registered: 3, minPlayers: 4, auto: true } });

		expect(await sizes(enough)).toEqual([2, 2]);
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
		// Nobody played, so nobody has a place.
		expect(
			(
				await t.sql`SELECT count(*)::int AS n FROM tournament_results WHERE tournament_id = ${id}`
			)[0].n,
		).toBe(0);

		const started = await tournament({ opens: -60, closes: -10, starts: -5 });
		await register(started, 2);
		await t.sql`UPDATE tournaments SET starts_at = now() + interval '10 min' WHERE id = ${started}`;
		await runTournamentJob(t.sql);
		await t.sql`UPDATE rooms SET started_at = now() WHERE tournament_id = ${started}`;
		await t.sql`UPDATE tournaments SET starts_at = now() - interval '5 min' WHERE id = ${started}`;
		await t.sql`UPDATE tournament_rounds SET starts_at = now() - interval '5 min' WHERE tournament_id = ${started}`;
		expect((await runTournamentJob(t.sql)).closed).toBe(0);
	});
});

describe("rounds", () => {
	let matchNumber = 0;

	/** Reports a table's match with players finishing in the order given. */
	async function play(roomId: string, order: string[]) {
		const [{ code }] = await t.sql`SELECT code FROM rooms WHERE id = ${roomId}`;
		matchNumber += 1;
		const now = new Date().toISOString();
		const report = {
			matchId: `01900000-0000-7000-8000-${String(matchNumber).padStart(12, "0")}`,
			game: "bust-31",
			roomCode: code,
			rulesVersion: 1,
			startedAt: now,
			endedAt: now,
			players: order.map((playerId, index) => ({
				seat: index,
				playerId,
				bot: false,
				placement: index + 1,
				score: 0,
			})),
			log: { logVersion: 1, events: [{ seq: 0, t: 0, type: "started" }] },
		};
		expect((await server("POST", "/v1/matches", report)).status).toBe(201);
	}

	const tablesOf = (id: string, round: number) =>
		t.sql`
			SELECT r.id, array_agg(ra.player_id ORDER BY ra.seat) AS players
			FROM rooms r
			JOIN room_assignments ra ON ra.room_id = r.id
			WHERE r.tournament_id = ${id} AND r.tournament_round = ${round}
			GROUP BY r.id
			ORDER BY r.id`;

	test("table winners meet in a final round 3 minutes later; its winner is the champion", async () => {
		const id = await tournament({ closes: -1, starts: 10, perRoom: 2 });
		await register(id, 4);
		await runTournamentJob(t.sql);

		const firstRound = await tablesOf(id, 1);
		expect(firstRound.length).toBe(2);
		const winners = firstRound.map((table: { players: string[] }) => table.players[1]!);
		for (const table of firstRound) {
			await play(table.id, [table.players[1], table.players[0]]);
		}

		const moved = await runTournamentJob(t.sql);
		expect(moved).toMatchObject({ nextRounds: 1, finished: 0 });

		const [firstDone] =
			await t.sql`SELECT ended_at FROM tournament_rounds WHERE tournament_id = ${id} AND round = 1`;
		expect(firstDone.ended_at).not.toBeNull();

		const [final] = await tablesOf(id, 2);
		expect([...final.players].sort()).toEqual([...winners].sort());
		const [{ minutes }] =
			await t.sql`SELECT round(extract(epoch FROM starts_at - now()) / 60)::int AS minutes FROM tournament_rounds WHERE tournament_id = ${id} AND round = 2`;
		expect(minutes).toBe(3);

		// The champion's lobby shows the final table; nothing more happens until it is played.
		expect((await runTournamentJob(t.sql)).nextRounds).toBe(0);
		await play(final.id, [winners[1], winners[0]]);
		expect(await runTournamentJob(t.sql)).toMatchObject({ finished: 1 });

		const results =
			await t.sql`SELECT player_id, place, wins, last_round FROM tournament_results WHERE tournament_id = ${id} ORDER BY place`;
		expect(results.length).toBe(4);
		expect(results[0]).toEqual({ player_id: winners[1], place: 1, wins: 2, last_round: 2 });
		expect(results[1]).toEqual({ player_id: winners[0], place: 2, wins: 1, last_round: 2 });
		expect(results.slice(2).map((row: { last_round: number }) => row.last_round)).toEqual([1, 1]);
		expect(
			(await t.sql`SELECT ended_at FROM tournaments WHERE id = ${id}`)[0].ended_at,
		).not.toBeNull();
	});

	test("Arena: everyone plays every round, reshuffled; most points wins after the last one", async () => {
		const id = await tournament({ closes: -1, starts: 10, perRoom: 2, format: "arena", rounds: 2 });
		const ids = await register(id, 4);
		await runTournamentJob(t.sql);

		// Round 1: the second-seated player wins each table.
		for (const table of await tablesOf(id, 1)) {
			await play(table.id, [table.players[1], table.players[0]]);
		}
		expect(await runTournamentJob(t.sql)).toMatchObject({ nextRounds: 1 });

		const secondRound = await tablesOf(id, 2);
		const seatedAgain = secondRound.flatMap((table: { players: string[] }) => table.players);
		expect([...seatedAgain].sort()).toEqual([...ids].sort());

		for (const table of secondRound) {
			await play(table.id, [table.players[0], table.players[1]]);
		}
		expect(await runTournamentJob(t.sql)).toMatchObject({ finished: 1 });

		const results =
			await t.sql`SELECT player_id, place, points, wins, last_round FROM tournament_results WHERE tournament_id = ${id} ORDER BY place`;
		expect(results.length).toBe(4);
		// Tables of two: a win is 2 points, a loss 1; four matches each round.
		const total = results.reduce((sum: number, row: { points: number }) => sum + row.points, 0);
		expect(total).toBe(12);
		expect(results.every((row: { last_round: number }) => row.last_round === 2)).toBe(true);
		expect(results[0].points).toBeGreaterThanOrEqual(results[3].points);
	});

	test("Swiss: round 2 seats round 1's winners together", async () => {
		const id = await tournament({ closes: -1, starts: 10, perRoom: 2, format: "swiss", rounds: 3 });
		await register(id, 4);
		await runTournamentJob(t.sql);

		const firstRound = await tablesOf(id, 1);
		const winners = firstRound.map((table: { players: string[] }) => table.players[0]!);
		for (const table of firstRound) {
			await play(table.id, [table.players[0], table.players[1]]);
		}
		await runTournamentJob(t.sql);

		const secondRound = await tablesOf(id, 2);
		const winnersTable = secondRound.find((table: { players: string[] }) =>
			table.players.includes(winners[0]),
		);
		expect([...winnersTable.players].sort()).toEqual([...winners].sort());
	});

	test("the lobby's live list: round, your place and table while it runs, then the winners for a day", async () => {
		const id = await tournament({ closes: -1, starts: 10, perRoom: 2 });
		const people = await Promise.all(["Ann", "Bob", "Cy", "Dee"].map((name) => guest(t.app, name)));
		await t.sql`INSERT INTO tournament_players ${t.sql(people.map((p) => ({ tournament_id: id, player_id: p.player.id })))}`;
		await runTournamentJob(t.sql);

		const live = async (secret: string) => {
			const list = await call(t.app, "GET", "/v1/tournaments?game=bust-31", { token: secret });
			return list.json.data.live.find((x: { id: string }) => x.id === id);
		};

		const ann = people[0]!;
		const first = await live(ann.secret);
		expect(first).toMatchObject({ round: 1, players: 4, endedAt: null, roundStarted: false });
		expect(first.table.code).toEqual(expect.any(String));
		expect(first.top).toEqual([]);

		for (const table of await tablesOf(id, 1)) {
			await play(table.id, [table.players[0], table.players[1]]);
		}
		await runTournamentJob(t.sql);

		const winners = (await tablesOf(id, 2))[0].players as string[];
		const winner = people.find((p) => p.player.id === winners[0])!;
		const loser = people.find((p) => !winners.includes(p.player.id))!;

		const running = await live(winner.secret);
		expect(running).toMatchObject({ round: 2, roundStarted: false });
		expect(running.table).toMatchObject({ started: false, closed: false });
		expect(running.me).toMatchObject({ lastRound: 2, wins: 1 });
		expect((await live(loser.secret)).table).toBeNull();

		const standings = await call(t.app, "GET", `/v1/tournaments/${id}/standings`, {
			token: loser.secret,
		});
		expect(standings.json.data.standings.length).toBe(4);
		expect(standings.json.data.standings[0]).toMatchObject({
			lastRound: 2,
			name: expect.any(String),
		});

		await play((await tablesOf(id, 2))[0].id, winners);
		await runTournamentJob(t.sql);

		const finished = await live(loser.secret);
		expect(finished.endedAt).not.toBeNull();
		expect(finished.top.map((x: { playerId: string }) => x.playerId).slice(0, 2)).toEqual(winners);
		expect(finished.top[0]).toMatchObject({ place: 1, wins: 2 });

		await t.sql`
			UPDATE tournaments
			SET
				registration_opens_at = now() - interval '50 hours',
				registration_closes_at = now() - interval '27 hours',
				starts_at = now() - interval '26 hours',
				ended_at = now() - interval '25 hours'
			WHERE id = ${id}`;
		expect(await live(loser.secret)).toBeUndefined();
	});

	test("a withdrawn winner doesn't go on, and a lone winner is the champion straight away", async () => {
		const id = await tournament({ closes: -1, starts: 10, perRoom: 2 });
		await register(id, 4);
		await runTournamentJob(t.sql);

		const firstRound = await tablesOf(id, 1);
		for (const table of firstRound) {
			await play(table.id, [table.players[0], table.players[1]]);
		}
		const quitter = firstRound[1].players[0];
		await t.sql`UPDATE tournament_players SET status = 'withdrawn', status_changed_at = now() WHERE tournament_id = ${id} AND player_id = ${quitter}`;

		expect(await runTournamentJob(t.sql)).toMatchObject({ nextRounds: 0, finished: 1 });
		const [champion] =
			await t.sql`SELECT player_id FROM tournament_results WHERE tournament_id = ${id} AND place = 1`;
		expect(champion.player_id).toBe(firstRound[0].players[0]);
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
			minPlayers: null,
			maxPlayers: null,
			format: null,
			description: null,
			prizes: [],
			players: ["Ann"],
			fee: 0,
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

describe("the lobby list", () => {
	test("names the first sign-ups and lists prizes by place", async () => {
		const cup = await tournament({ closes: 5, starts: 15 });
		await register(cup, 7);
		await t.sql`INSERT INTO tournament_prizes (tournament_id, place, coins, extra) VALUES (${cup}, 2, 1000, NULL), (${cup}, 1, 2000, 'Night Owl badge')`;
		const ann = await guest(t.app, "Ann");

		const list = await call(t.app, "GET", "/v1/tournaments?game=bust-31", { token: ann.secret });
		const listed = list.json.data.tournaments.find((x: { id: string }) => x.id === cup);

		expect(listed.players).toEqual(["P0", "P1", "P2", "P3", "P4"]);
		expect(listed.prizes).toEqual([
			{ place: 1, coins: 2000, extra: "Night Owl badge" },
			{ place: 2, coins: 1000, extra: null },
		]);
		expect(listed.registrationOpensAt).toEqual(expect.any(String));
	});
});

describe("a full tournament", () => {
	test("refuses a new sign-up, but not one already in; a freed place can be taken again", async () => {
		const cup = await tournament({ closes: 5, starts: 15, perRoom: 2, max: 2 });
		await register(cup, 1);
		const ann = await guest(t.app, "Ann");
		const bob = await guest(t.app, "Bob");
		const join = (secret: string) =>
			call(t.app, "POST", `/v1/tournaments/${cup}/registration`, { token: secret });

		expect((await join(ann.secret)).status).toBe(200);
		expect((await join(ann.secret)).status).toBe(200);

		const full = await join(bob.secret);
		expect(full.status).toBe(409);
		expect(full.json.error.message).toBe("Sign-up is closed: this tournament is full.");

		const list = await call(t.app, "GET", "/v1/tournaments?game=bust-31", { token: bob.secret });
		const listed = list.json.data.tournaments.find((x: { id: string }) => x.id === cup);
		expect(listed).toMatchObject({ registered: 2, maxPlayers: 2, joined: false });

		await call(t.app, "DELETE", `/v1/tournaments/${cup}/registration`, { token: ann.secret });
		expect((await join(bob.secret)).status).toBe(200);
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
				started: false,
				tournament: { id, name: "Friday Cup", startsAt: expect.any(String) },
			},
		]);
		const enter = await call(t.app, "GET", `/v1/rooms/${code}`, { token: ann.secret });
		expect(enter.json.data.room.tournament.name).toBe("Friday Cup");
		const outsider = await guest(t.app, "Cy");
		const refused = await call(t.app, "GET", `/v1/rooms/${code}`, { token: outsider.secret });
		expect(refused.status).toBe(403);
		expect(refused.json.error.message).toBe("This table is for players of Friday Cup.");
		const share = await call(t.app, "POST", `/v1/rooms/${code}/invites`, { token: ann.secret });
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

	test("start, then the match report closes the room; the job then ends the tournament with its result", async () => {
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
		expect((await t.sql`SELECT ended_at FROM tournaments WHERE id = ${id}`)[0].ended_at).toBeNull();

		// One table, so its winner is the champion: no further round.
		await runTournamentJob(t.sql);
		expect(
			(await t.sql`SELECT ended_at FROM tournaments WHERE id = ${id}`)[0].ended_at,
		).not.toBeNull();
		expect(
			await t.sql`SELECT player_id, place, wins, last_round FROM tournament_results WHERE tournament_id = ${id} ORDER BY place`,
		).toEqual([
			{ player_id: ann.player.id, place: 1, wins: 1, last_round: 1 },
			{ player_id: ben.player.id, place: 2, wins: 0, last_round: 1 },
		]);
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

describe("withdrawn and disqualified players", () => {
	const disqualify = (tournamentId: string, playerId: string) => t.sql`
		UPDATE tournament_players
		SET status = 'disqualified', status_reason = 'Cheating', status_changed_at = now()
		WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}`;

	test("after the tables are handed out a player withdraws; their seat is freed and they can't come back", async () => {
		const id = await tournament({ closes: -1, starts: 10, perRoom: 3 });
		const [ann, ben, cy] = await Promise.all(
			["Ann", "Ben", "Cy"].map((name) => guest(t.app, name)),
		);
		await t.sql`INSERT INTO tournament_players ${t.sql([ann!, ben!, cy!].map((p) => ({ tournament_id: id, player_id: p.player.id })))}`;
		await runTournamentJob(t.sql);
		const [{ code }] = await t.sql`SELECT code FROM rooms WHERE tournament_id = ${id}`;
		const registration = (method: string, token: string) =>
			call(t.app, method, `/v1/tournaments/${id}/registration`, { token });

		expect((await registration("DELETE", ann!.secret)).status).toBe(200);
		const [row] =
			await t.sql`SELECT status, status_changed_at FROM tournament_players WHERE tournament_id = ${id} AND player_id = ${ann!.player.id}`;
		expect(row.status).toBe("withdrawn");
		expect(row.status_changed_at).not.toBeNull();
		expect(
			(await call(t.app, "GET", "/v1/players/me/rooms", { token: ann!.secret })).json.data.rooms,
		).toEqual([]);
		const enter = await call(t.app, "GET", `/v1/rooms/${code}`, { token: ann!.secret });
		expect(enter.status).toBe(403);
		expect(enter.json.error.message).toBe("You withdrew from Friday Cup.");
		expect((await registration("POST", ann!.secret)).status).toBe(409);

		// Disqualified mid-way: the seat stays on record, but the room no longer counts them.
		await disqualify(id, ben!.player.id);
		const refused = await call(t.app, "GET", `/v1/rooms/${code}`, { token: ben!.secret });
		expect(refused.json.error.message).toBe("You were disqualified from Friday Cup.");
		const seats = (await server("GET", `/v1/rooms/${code}/seats`)).json.data.room.seats;
		expect(seats.map((s: { playerId: string }) => s.playerId)).toEqual([cy!.player.id]);

		await server("POST", `/v1/rooms/${code}/start`);
		const late = await registration("DELETE", cy!.secret);
		expect(late.status).toBe(409);
		expect(late.json.error.message).toBe(
			"Your table already started. Leave it from the table instead.",
		);
	});

	test("a disqualified player can't sign up again or erase it by leaving", async () => {
		const id = await tournament({ closes: 5, starts: 15 });
		const ann = await guest(t.app, "Ann");
		const registration = (method: string) =>
			call(t.app, method, `/v1/tournaments/${id}/registration`, { token: ann.secret });

		await registration("POST");
		await disqualify(id, ann.player.id);

		const again = await registration("POST");
		expect(again.status).toBe(403);
		expect(again.json.error.message).toBe("You were disqualified from this tournament.");
		expect((await registration("DELETE")).status).toBe(200);

		const list = await call(t.app, "GET", "/v1/tournaments?game=bust-31", { token: ann.secret });
		const cup = list.json.data.tournaments.find((x: { id: string }) => x.id === id);
		expect(cup).toMatchObject({ registered: 0, joined: false });
		expect(
			(await t.sql`SELECT status FROM tournament_players WHERE tournament_id = ${id}`)[0].status,
		).toBe("disqualified");
	});
});
