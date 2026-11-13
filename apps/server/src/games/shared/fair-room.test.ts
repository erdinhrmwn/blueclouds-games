import { Database } from "bun:sqlite";
import { expect, mock, test } from "bun:test";

// The platform is replaced: this test is about what the room deals, logs and reports.
mock.module("../../platform", () => ({
	verifyPlayToken: async () => null,
	reportMatch: async () => ({ result: "sent" }),
	fetchRoomSeats: async () => null,
	markRoom: async () => ({ ok: true }),
	fetchVipIds: async () => new Set(),
}));
const room = await import("./room");
const { checkFairness, proofFromLog } = await import("./fairness");
const { chooseBotCard } = await import("../bust-31/bots");
const match = await import("../bust-31/match");
const rules = await import("../bust-31/rules");
const { RuleError } = await import("./table");

/** Just enough of an actor context for commitRoom: SQLite in memory, no connections, an open private table. */
function fakeRoom() {
	const sqlite = new Database(":memory:");
	const execute = async (sql: string, ...args: (string | number)[]) =>
		sqlite.query(sql).all(...args) as Record<string, unknown>[];
	const db = {
		execute,
		transaction: async (fn: (tx: { execute: typeof execute }) => Promise<void>) => {
			sqlite.run("BEGIN");
			await fn({ execute });
			sqlite.run("COMMIT");
		},
	};

	let game = rules.createGame();
	game = rules.addPlayer(game, "ann", "Ann", false, 0);
	game = rules.addPlayer(game, "bot-1", "Bot Rain", true, 2);
	game = rules.addPlayer(game, "bot-2", "Bot Wind", true, 4);

	const vars = { ...room.roomVars(game), tournament: null, listed: false };
	const c = {
		vars,
		db,
		key: ["ROOM42"],
		conns: new Map(),
		broadcast: () => {},
		log: { warn: () => {}, info: () => {} },
		schedule: { after: async () => {}, at: async () => {} },
	};

	return { c, db };
}

const commit = (c: unknown, auto = false) =>
	room.commitRoom(
		c,
		{
			slug: "bust-31",
			scheduleTurn: async () => {},
			logEvents: match.logEvents,
			noteMove: match.noteMove,
			buildReport: match.buildReport,
			view: () => null,
			handOf: () => null,
		},
		auto,
	);

test("a match deals from the seed it committed to before it started, and reports the proof", async () => {
	const { c, db } = fakeRoom();
	await room.migrateRoom(db);

	const committed = { ...c.vars.next! };
	expect(room.fairnessView(c).serverSeedHash).toBe(committed.serverSeedHash);

	room.beginMatch(c, { out: [] }, (rng) => rules.startGame(c.vars.game, "ann", rng));
	await commit(c);
	expect(c.vars.next!.matchId).not.toBe(committed.matchId);

	while (c.vars.game.phase === "playing") {
		const player = c.vars.game.players[c.vars.game.turn]!;
		const card = chooseBotCard(player.hand, c.vars.game.total)!;
		c.vars.game = room.withRng(c, (rng) => rules.playCard(c.vars.game, player.id, card.id, rng));
		await commit(c, true);
	}

	const [row] = await db.execute("SELECT body FROM match_reports");
	const report = JSON.parse(String(row!.body));

	expect(report.matchId).toBe(committed.matchId);
	expect(report.fairness).toEqual({
		serverSeed: committed.serverSeed,
		serverSeedHash: committed.serverSeedHash,
		clientSeed: `${committed.matchId}|0:ann,2:bot:Bot Rain,4:bot:Bot Wind`,
	});

	const types = report.log.events.map((event: { type: string }) => event.type);
	expect(types[0]).toBe("fairness");
	expect(types[1]).toBe("shuffle");
	expect(types.at(-1)).toBe("reveal");

	const proof = proofFromLog(report.log.events)!;
	expect(await checkFairness(proof)).toMatchObject({ ok: true });
	expect(room.lastProof(c)!.shuffles).toEqual(proof.shuffles);
	expect(room.fairnessView(c).revealed).not.toHaveProperty("shuffles");
});

test("a move the rules refuse takes back its shuffle", () => {
	const { c } = fakeRoom();
	room.beginMatch(c, { out: [] }, (rng) => rules.startGame(c.vars.game, "ann", rng));
	const before = { nonce: c.vars.match!.seeds!.nonce, pending: c.vars.fairLog.length };

	expect(() =>
		room.withRng(c, (rng) => {
			rng.shuffle([{ id: "a" }, { id: "b" }]);
			throw new RuleError("nope");
		}),
	).toThrow("nope");

	expect(c.vars.match!.seeds!.nonce).toBe(before.nonce);
	expect(c.vars.fairLog.length).toBe(before.pending);
});

test("a start the rules refuse leaves no match and keeps the commitment", () => {
	const { c } = fakeRoom();
	const committed = c.vars.next;

	expect(() =>
		room.beginMatch(c, { out: [] }, (rng) => rules.startGame(c.vars.game, "bot-1", rng)),
	).toThrow();
	expect(c.vars.match).toBeNull();
	expect(c.vars.next).toBe(committed);
});
