import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, guest, SERVER_KEY, setupTestApp } from "./test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let ann: Awaited<ReturnType<typeof guest>>;
let bob: Awaited<ReturnType<typeof guest>>;
beforeAll(async () => {
	t = await setupTestApp();
	ann = await guest(t.app, "Ann");
	bob = await guest(t.app, "Bob");
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
		{ seat: 0, playerId: ann.player.id, bot: false, placement: 1, livesLeft: 2 },
		{ seat: 2, playerId: bob.player.id, bot: false, placement: 3, livesLeft: 0 },
		{ seat: 3, playerId: null, bot: true, botName: "Bot Rain", placement: 2, livesLeft: 0 },
	],
	...over,
});
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

	test("unknown player → 422 and nothing is stored", async () => {
		const body = report({
			players: [
				{ seat: 0, playerId: Bun.randomUUIDv7(), bot: false, placement: 1, livesLeft: 1 },
				{ seat: 1, playerId: null, bot: true, placement: 2, livesLeft: 0 },
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
				{ seat: 0, playerId: null, bot: true, placement: 1, livesLeft: 1 },
				{ seat: 1, playerId: null, bot: true, placement: 2, livesLeft: 0 },
			],
		});
		expect((await post(body)).status).toBe(201);
	});

	test("rejects invalid reports with field errors", async () => {
		const twoWinners = report({
			players: [
				{ seat: 0, playerId: ann.player.id, bot: false, placement: 1, livesLeft: 1 },
				{ seat: 1, playerId: null, bot: true, placement: 1, livesLeft: 0 },
			],
		});
		const res = await post(twoWinners);
		expect(res.status).toBe(400);
		expect(res.json.error.fields.players).toBe("Exactly one player must place first.");

		expect((await post(report({ game: "chess" }))).json.error.fields.game).toBe("Unknown game.");
		expect((await post(report({ matchId: crypto.randomUUID() }))).status).toBe(400); // not v7
		expect((await post(report({ endedAt: "2026-11-11T07:00:00Z" }))).json.error.fields.endedAt).toBeTruthy();
	});
});

describe("my match history", () => {
	test("lists my matches newest first with paging", async () => {
		const carl = await guest(t.app, "Carl");
		const ids: string[] = [];
		for (let i = 0; i < 22; i++) {
			const body = report({
				players: [
					{ seat: 0, playerId: carl.player.id, bot: false, placement: i % 2 ? 1 : 2, livesLeft: 1 },
					{ seat: 1, playerId: null, bot: true, placement: i % 2 ? 2 : 1, livesLeft: 0 },
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
