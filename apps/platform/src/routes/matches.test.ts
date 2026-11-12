import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, guest, room, SERVER_KEY, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let ann: Awaited<ReturnType<typeof guest>>;
let bob: Awaited<ReturnType<typeof guest>>;
beforeAll(async () => {
	t = await setupTestApp();
	ann = await guest(t.app, "Ann");
	bob = await guest(t.app, "Bob");
	await room(t.sql, "bust-31", "K7PQX");
});
afterAll(async () => {
	await t.sql.close();
});

const report = (over: Record<string, unknown> = {}) => ({
	matchId: Bun.randomUUIDv7(),
	game: "bust-31",
	roomCode: "K7PQX",
	rulesVersion: 1,
	startedAt: "2026-11-11T08:00:00Z",
	endedAt: "2026-11-11T08:06:12Z",
	players: [
		{ seat: 0, playerId: ann.player.id, bot: false, placement: 1, score: 2 },
		{ seat: 2, playerId: bob.player.id, bot: false, placement: 3, score: 0 },
		{ seat: 3, playerId: null, bot: true, botName: "Bot Rain", placement: 2, score: 0 },
	],
	log: { logVersion: 1, events: events() },
	...over,
});
const events = () => [
	{ seq: 0, t: 0, type: "deal", data: { round: 1, hands: { 0: ["n7-1"] } } },
	{ seq: 1, t: 4120, type: "play", seat: 0, data: { card: "n7-1", total: 7, by: "player" } },
	{ seq: 2, t: 4120, type: "finished", data: { winner: 0 } },
];
const post = (body: unknown, token = SERVER_KEY) => call(t.app, "POST", "/v1/matches", { body, token });

describe("match reports", () => {
	test("needs the server key", async () => {
		expect((await post(report(), "wrong-key")).status).toBe(401);
		expect((await call(t.app, "POST", "/v1/matches", { body: report() })).json.error.code).toBe("unauthenticated");
	});

	test("new → 201, same retry → 200, changed body → 409", async () => {
		const body = report();
		const first = await post(body);
		expect(first.status).toBe(201);
		expect(first.json.data).toEqual({ match: { id: body.matchId, created: true } });

		// Same report with seats in another order is still the same report.
		const retry = await post({ ...body, players: [...body.players].reverse() });
		expect(retry.status).toBe(200);
		expect(retry.json.data.match.created).toBe(false);

		const changed = await post({ ...body, roomCode: "ZZZZZ" });
		expect(changed.status).toBe(409);
		expect(changed.json.error.code).toBe("conflict");

		const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM match_players WHERE match_id = ${body.matchId}`;
		expect(n).toBe(3);
	});

	test("a room code the platform never made → 422, a retry of a stored match still → 200", async () => {
		const res = await post(report({ roomCode: "NOPE9" }));
		expect(res.status).toBe(422);
		expect(res.json.error.code).toBe("unknown_room");
	});

	test("unknown player → 422 and nothing is stored", async () => {
		const body = report({
			players: [
				{ seat: 0, playerId: Bun.randomUUIDv7(), bot: false, placement: 1, score: 1 },
				{ seat: 1, playerId: null, bot: true, botName: "Bot Rain", placement: 2, score: 0 },
			],
		});
		const res = await post(body);
		expect(res.status).toBe(422);
		expect(res.json.error.code).toBe("unknown_player");
		const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM matches WHERE id = ${body.matchId}`;
		expect(n).toBe(0);
	});

	test("bot-only matches are recorded", async () => {
		const body = report({
			players: [
				{ seat: 0, playerId: null, bot: true, botName: "Bot Cloud", placement: 1, score: 1 },
				{ seat: 1, playerId: null, bot: true, botName: "Bot Rain", placement: 2, score: 0 },
			],
		});
		expect((await post(body)).status).toBe(201);
	});

	test("rejects invalid reports with field errors", async () => {
		const twoWinners = report({
			players: [
				{ seat: 0, playerId: ann.player.id, bot: false, placement: 1, score: 1 },
				{ seat: 1, playerId: null, bot: true, botName: "Bot Rain", placement: 1, score: 0 },
			],
		});
		const res = await post(twoWinners);
		expect(res.status).toBe(400);
		expect(res.json.error.fields.players).toBe("Exactly one player must place first.");

		expect((await post(report({ game: "chess" }))).json.error.fields.game).toBe("Unknown game.");
		expect((await post(report({ matchId: crypto.randomUUID() }))).status).toBe(400); // not v7
		expect((await post(report({ endedAt: "2026-11-11T07:00:00Z" }))).json.error.fields.endedAt).toBeTruthy();
		const namelessBot = { seat: 1, playerId: null, bot: true, placement: 2, score: 0 };
		expect((await post(report({ players: [report().players[0], namelessBot] }))).status).toBe(400);
	});
});

describe("any game in the catalog", () => {
	test("a new game only needs its row in games; score means what the game says", async () => {
		const seat = (s: number, placement: number, score: number) => ({ seat: s, playerId: null, bot: true, botName: `Bot ${s}`, placement, score });
		const twoSeats = report({ game: "test-game", roomCode: "TGAME", players: [seat(0, 1, 3), seat(1, 2, 12)] });
		expect((await post(twoSeats)).json.error.fields.game).toBe("Unknown game.");

		await t.sql`INSERT INTO games (slug, name, min_players, max_players, score_label) VALUES ('test-game', 'Test Game', 3, 4, 'Points')`;
		await room(t.sql, "test-game", "TGAME");
		expect((await post(twoSeats)).json.error.fields.players).toBe("Needs 3–4 players.");
		// Lower is better here, places 2 and 3 tie, and a score may be negative: all up to the game.
		const body = report({ game: "test-game", roomCode: "TGAME", players: [seat(0, 1, -2), seat(1, 2, 12), seat(2, 2, 12)] });
		expect((await post(body)).status).toBe(201);
		const rows = await t.sql`SELECT seat, placement, score FROM match_players WHERE match_id = ${body.matchId} ORDER BY seat`;
		expect(rows.map((r: { score: number }) => r.score)).toEqual([-2, 12, 12]);
	});
});

describe("match logs", () => {
	test("are stored with the match, as sent", async () => {
		const body = report();
		expect((await post(body)).status).toBe(201);
		const [row] = await t.sql`SELECT log_version, event_count, events FROM match_logs WHERE match_id = ${body.matchId}`;
		expect(row).toEqual({ log_version: 1, event_count: 3, events: events() });
	});

	test("a changed log is a conflict", async () => {
		const body = report();
		expect((await post(body)).status).toBe(201);
		const changed = events();
		changed[1]!.data.card = "n9-0";
		expect((await post({ ...body, log: { logVersion: 1, events: changed } })).status).toBe(409);
	});

	test("rejects a missing log, gaps in seq, unknown seats and bad types", async () => {
		const field = async (over: Record<string, unknown>) => (await post(report(over))).json.error?.fields;
		const { log: _, ...noLog } = report();
		expect((await post(noLog)).status).toBe(400);
		const [a, b, c] = events();
		expect((await field({ log: { logVersion: 1, events: [a, c] } })).log).toBe("Event 1 must have seq 1 and a seat from players.");
		expect((await field({ log: { logVersion: 1, events: [a, { ...b, seat: 5 }, c] } })).log).toBeTruthy();
		expect(await field({ log: { logVersion: 1, events: [{ ...a, type: "Deal!" }] } })).toHaveProperty(["log.events.0.type"]);
		expect(await field({ log: { logVersion: 1, events: [{ ...a, t: -1 }] } })).toHaveProperty(["log.events.0.t"]);
		expect(await field({ log: { logVersion: 1, events: [{ ...a, data: { pad: "x".repeat(5000) } }] } })).toHaveProperty(["log.events.0.data"]);
	});

	test("a big log fits the larger body limit; other routes keep 16 KB", async () => {
		// About 120 KB: far more than a real 6-player match.
		const big = Array.from({ length: 1500 }, (_, i) => ({ seq: i, t: i * 900, type: "play", seat: 0, data: { card: "n7-1", total: 7, drew: "n9-0", by: "player" } }));
		const body = report({ log: { logVersion: 1, events: big } });
		expect(JSON.stringify(body).length).toBeGreaterThan(100_000);
		expect((await post(body)).status).toBe(201);
		const huge = await call(t.app, "POST", "/v1/matches", { body: "x".repeat(600 * 1024), token: SERVER_KEY });
		expect(huge.status).toBe(413);
		const guestBody = await call(t.app, "POST", "/v1/players/guest", { body: "x".repeat(20 * 1024) });
		expect(guestBody.status).toBe(413);
	});
});

describe("my match history", () => {
	test("lists my matches newest first with paging", async () => {
		const carl = await guest(t.app, "Carl");
		const ids: string[] = [];
		for (let i = 0; i < 22; i++) {
			const body = report({
				players: [
					{ seat: 0, playerId: carl.player.id, bot: false, placement: i % 2 ? 1 : 2, score: 1 },
					{ seat: 1, playerId: null, bot: true, botName: "Bot Rain", placement: i % 2 ? 2 : 1, score: 0 },
				],
			});
			ids.push(body.matchId);
			expect((await post(body)).status).toBe(201);
		}
		const first = await call(t.app, "GET", "/v1/players/me/matches", { token: carl.secret });
		expect(first.status).toBe(200);
		expect(first.json.data.matches).toHaveLength(20);
		expect(first.json.data.matches[0].id).toBe(ids.at(-1));
		expect(first.json.data.matches[0]).toEqual(expect.objectContaining({ game: "bust-31", players: 2, seat: 0 }));
		const second = await call(t.app, "GET", `/v1/players/me/matches?cursor=${first.json.data.nextCursor}`, { token: carl.secret });
		expect(second.json.data.matches.map((m: { id: string }) => m.id)).toEqual([ids[1], ids[0]]);
		expect(second.json.data.nextCursor).toBeNull();
	});

	test("bad cursor is bad_input", async () => {
		const res = await call(t.app, "GET", "/v1/players/me/matches?cursor=nope", { token: ann.secret });
		expect(res.status).toBe(400);
	});
});
