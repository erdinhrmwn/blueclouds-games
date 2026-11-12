import { beforeEach, expect, mock, test } from "bun:test";

// The platform is replaced: these tests are about which tags change and when the check runs again.
let vipIds = new Set<string>();
let platformDown = false;
mock.module("../../platform", () => ({
	verifyPlayToken: async () => null,
	reportMatch: async () => ({ result: "sent" }),
	fetchRoomSeats: async () => null,
	markRoom: async () => ({ ok: true }),
	fetchVipIds: async () => {
		if (platformDown) {
			throw new Error("platform down");
		}

		return vipIds;
	},
}));
const { refreshVips, VIP_REFRESH_MS } = await import("./room");
const { addPlayer, createGame } = await import("../bust-31/rules");
const { markVip, showVips } = await import("./table");

const DUE = 1_000;

function room(connections: number) {
	const scheduled: number[] = [];
	let game = createGame();
	game = addPlayer(game, "ann", "Ann");
	game = addPlayer(game, "ben", "Ben");
	game = addPlayer(game, "bot", "Bot Rain", true);

	return {
		scheduled,
		vars: { game, vipCheckAt: DUE as number | null },
		conns: new Map(Array.from({ length: connections }, (_, i) => [`conn${i}`, {}])),
		log: { warn: () => {} },
		schedule: { at: async (at: number) => void scheduled.push(at) },
	};
}

const vipsOf = (c: ReturnType<typeof room>) =>
	c.vars.game.players.filter((player) => player.vip).map((player) => player.id);

beforeEach(() => {
	vipIds = new Set();
	platformDown = false;
});

test("a grant and a revoke both reach the seated tags; bots are left alone", async () => {
	const c = room(1);
	c.vars.game = markVip(c.vars.game, "ben");
	vipIds = new Set(["ann"]);

	expect(await refreshVips(c, DUE)).toBe(true);
	expect(vipsOf(c)).toEqual(["ann"]);
	expect(c.vars.game.players.find((player) => player.id === "bot")?.vip).toBeUndefined();
});

test("nothing to send when no tag changes", async () => {
	const c = room(1);
	c.vars.game = markVip(c.vars.game, "ann");
	vipIds = new Set(["ann"]);

	expect(await refreshVips(c, DUE)).toBe(false);
	expect(showVips(c.vars.game, vipIds)).toBe(c.vars.game);
});

test("keeps checking while someone is connected, and stops when the room is empty", async () => {
	const open = room(2);
	await refreshVips(open, DUE);
	expect(open.scheduled).toHaveLength(1);
	expect(open.scheduled[0]! - Date.now()).toBeLessThanOrEqual(VIP_REFRESH_MS);

	const empty = room(0);
	await refreshVips(empty, DUE);
	expect(empty.scheduled).toHaveLength(0);
	expect(empty.vars.vipCheckAt).toBeNull();
});

test("a timer from before a sleep is ignored", async () => {
	const c = room(1);
	vipIds = new Set(["ann"]);

	expect(await refreshVips(c, DUE - 1)).toBe(false);
	expect(vipsOf(c)).toEqual([]);
	expect(c.scheduled).toHaveLength(0);
});

test("the platform being down changes nothing and the check runs again", async () => {
	const c = room(1);
	platformDown = true;

	expect(await refreshVips(c, DUE)).toBe(false);
	expect(c.scheduled).toHaveLength(1);
});
