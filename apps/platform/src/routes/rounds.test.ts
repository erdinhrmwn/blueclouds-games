import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, guest, room, SERVER_KEY, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let ann: Awaited<ReturnType<typeof guest>>;
beforeAll(async () => {
	t = await setupTestApp();
	ann = await guest(t.app, "Ann");
	await room(t.sql, "bust-31", "R0UND");
});
afterAll(async () => {
	await t.sql.close();
});

let roundSeedCount = 0;

/** A round's seed and its hash; each call gives another. */
function roundSeed() {
	roundSeedCount += 1;
	const serverSeed = roundSeedCount.toString(16).padStart(2, "0").repeat(32);
	const serverSeedHash = new Bun.CryptoHasher("sha256").update(serverSeed).digest("hex");

	return { serverSeed, serverSeedHash };
}

const roundBody = (matchId: string, round: number, over: Record<string, unknown> = {}) => ({
	roundId: Bun.randomUUIDv7(),
	game: "bust-31",
	roomCode: "R0UND",
	round,
	...roundSeed(),
	shuffles: [{ nonce: 0, clientSeed: `${matchId}:${round}:0`, deck: ["n7-1", "n3-2", "m-0"] }],
	result: { seat: 0, total: 33, lives: 2 },
	events: [{ seq: 2, t: 0, type: "deal", data: { round } }],
	startedAt: "2026-11-13T08:00:00Z",
	endedAt: "2026-11-13T08:01:30Z",
	...over,
});

const postRound = (matchId: string, body: unknown, token = SERVER_KEY) =>
	call(t.app, "POST", `/v1/matches/${matchId}/rounds`, { body, token });

const getRounds = (matchId: string, token = ann.secret) =>
	call(t.app, "GET", `/v1/matches/${matchId}/rounds`, { token });

/** A finished match report for the rounds above. */
const finishedReport = (matchId: string) => ({
	matchId,
	game: "bust-31",
	roomCode: "R0UND",
	rulesVersion: 1,
	startedAt: "2026-11-13T08:00:00Z",
	endedAt: "2026-11-13T08:05:00Z",
	players: [
		{ seat: 0, playerId: ann.player.id, bot: false, placement: 1, score: 2 },
		{ seat: 1, playerId: null, bot: true, botName: "Bot Rain", placement: 2, score: 0 },
	],
	log: { logVersion: 1, events: [{ seq: 0, t: 0, type: "finished", data: { winner: 0 } }] },
});

describe("round reports", () => {
	test("need the server key", async () => {
		const matchId = Bun.randomUUIDv7();

		expect((await postRound(matchId, roundBody(matchId, 1), "wrong-key")).status).toBe(401);
	});

	test("new → 201, same retry → 200, changed body → 409", async () => {
		const matchId = Bun.randomUUIDv7();
		const body = roundBody(matchId, 1);

		const first = await postRound(matchId, body);
		expect(first.status).toBe(201);
		expect(first.json.data).toEqual({ round: { matchId, round: 1, created: true } });

		expect((await postRound(matchId, body)).status).toBe(200);
		expect((await postRound(matchId, { ...body, result: { seat: 1 } })).status).toBe(409);

		// A round id belongs to one round only.
		expect(
			(await postRound(matchId, { ...roundBody(matchId, 2), roundId: body.roundId })).status,
		).toBe(409);

		const [{ n }] =
			await t.sql`SELECT count(*)::int AS n FROM round_fairness WHERE round_id = ${body.roundId}`;
		expect(n).toBe(1);
	});

	test("refuses a seed that misses its hash, a wrong client seed, nonces out of order or another room", async () => {
		const matchId = Bun.randomUUIDv7();
		expect((await postRound(matchId, roundBody(matchId, 1))).status).toBe(201);

		const field = async (body: unknown) => (await postRound(matchId, body)).json.error?.fields;

		const wrongSeed = roundBody(matchId, 2, { serverSeed: "cd".repeat(32) });
		expect(await field(wrongSeed)).toHaveProperty("serverSeed");

		const wrongClientSeed = roundBody(matchId, 2, {
			shuffles: [{ nonce: 0, clientSeed: `${matchId}:9:0`, deck: ["n7-1"] }],
		});
		expect(await field(wrongClientSeed)).toHaveProperty("shuffles");

		const skipped = roundBody(matchId, 2, {
			shuffles: [{ nonce: 1, clientSeed: `${matchId}:2:1`, deck: ["n7-1"] }],
		});
		expect((await postRound(matchId, skipped)).status).toBe(400);

		await room(t.sql, "bust-31", "OTHER1");
		const otherRoom = roundBody(matchId, 2, { roomCode: "OTHER1" });
		expect((await postRound(matchId, otherRoom)).status).toBe(409);
	});
});

describe("round report size", () => {
	test("a long round (over the 16 KB default) is accepted", async () => {
		const matchId = Bun.randomUUIDv7();
		const moves = Array.from({ length: 300 }, (_, seq) => ({
			seq,
			t: seq * 1000,
			type: "play",
			seat: 0,
			data: { card: "n7-1", total: 7, by: "bot" },
		}));

		const res = await postRound(matchId, roundBody(matchId, 1, { events: moves }));
		expect(res.status).toBe(201);
	});
});

describe("a match's rounds", () => {
	test("need a signed-in player; an unknown match is 404", async () => {
		const matchId = Bun.randomUUIDv7();

		expect((await call(t.app, "GET", `/v1/matches/${matchId}/rounds`)).status).toBe(401);
		expect((await getRounds(matchId)).status).toBe(404);
	});

	test("show every closed round with its revealed seed while the match runs, and after", async () => {
		const matchId = Bun.randomUUIDv7();
		const one = roundBody(matchId, 1);
		const two = roundBody(matchId, 2, {
			shuffles: [
				{ nonce: 0, clientSeed: `${matchId}:2:0`, deck: ["n7-1"] },
				{ nonce: 1, clientSeed: `${matchId}:2:1`, deck: ["m-0"] },
			],
		});
		await postRound(matchId, one);
		await postRound(matchId, two);

		const running = await getRounds(matchId);
		expect(running.status).toBe(200);
		expect(running.json.data.match).toEqual({
			id: matchId,
			game: "bust-31",
			finished: false,
			players: [],
		});

		const [first, second] = running.json.data.rounds;
		expect(first).toEqual({
			id: one.roundId,
			round: 1,
			startedAt: "2026-11-13T08:00:00.000Z",
			endedAt: "2026-11-13T08:01:30.000Z",
			result: { seat: 0, total: 33, lives: 2 },
			events: one.events,
			serverSeedHash: one.serverSeedHash,
			serverSeed: one.serverSeed,
			shuffles: one.shuffles,
		});
		expect(second.shuffles.map((shuffle: { clientSeed: string }) => shuffle.clientSeed)).toEqual([
			`${matchId}:2:0`,
			`${matchId}:2:1`,
		]);

		const reported = await call(t.app, "POST", "/v1/matches", {
			body: finishedReport(matchId),
			token: SERVER_KEY,
		});
		expect(reported.status).toBe(201);
		const finished = (await getRounds(matchId)).json.data.match;
		expect(finished.finished).toBe(true);
		expect(finished.players).toEqual([
			{ seat: 0, name: "Ann" },
			{ seat: 1, name: "Bot Rain" },
		]);
	});
});
