import { afterEach, beforeEach, expect, mock, setSystemTime, test } from "bun:test";

// The platform calls are replaced: these tests are about when a tournament table starts or gives up.
const marked: string[] = [];
let seats: unknown = null;
mock.module("../../platform", () => ({
	verifyPlayToken: async () => null,
	reportMatch: async () => ({ result: "sent" }),
	fetchRoomSeats: async () => seats,
	markRoom: async (code: string, change: string) => (marked.push(`${code}:${change}`), true),
}));
const { LATE_GRACE_MS, loadTournament, requireOpenTable, seatFor, tournamentTick } = await import("./room");
const { addPlayer, createGame } = await import("../bust-31/rules");

const START = Date.parse("2026-11-11T20:00:00Z");
const ANN = "01900000-0000-7000-8000-0000000000a1";
const BEN = "01900000-0000-7000-8000-0000000000b2";
const CY = "01900000-0000-7000-8000-0000000000c3";

function room() {
	return {
		key: ["CUP01"],
		vars: { game: createGame(), tournament: undefined as any },
		log: { warn: () => {} },
		schedule: { at: async () => {} },
	};
}
type Room = ReturnType<typeof room>;

/** Counts starts and commits instead of running a real match. */
function runner(c: Room) {
	const calls = { started: 0, commits: 0 };
	return {
		calls,
		game: {
			start: () => {
				calls.started++;
				c.vars.game = { ...c.vars.game, phase: "playing" };
			},
			commit: async () => void calls.commits++,
		},
	};
}

const sit = (c: Room, ...ids: string[]) => ids.forEach((id, i) => (c.vars.game = addPlayer(c.vars.game, id, `P${i}`, false, i)));

beforeEach(() => {
	marked.length = 0;
	seats = {
		minPlayers: 2,
		startedAt: null,
		closedAt: null,
		tournament: { name: "Friday Cup", startsAt: new Date(START).toISOString(), cancelled: false },
		seats: [
			{ playerId: ANN, seat: 0 },
			{ playerId: BEN, seat: 1 },
			{ playerId: CY, seat: 2 },
		],
	};
});
afterEach(() => setSystemTime());

test("only assigned players sit, each on their own seat; host controls are off", async () => {
	const c = room();
	expect(await seatFor(c, { id: BEN, name: "Ben" })).toBe(1);
	expect(seatFor(c, { id: "01900000-0000-7000-8000-0000000000ff", name: "Dee" })).rejects.toThrow("This table is for players of Friday Cup.");
	expect(() => requireOpenTable(c)).toThrow("A tournament table starts on its own.");
});

test("an open room lets anyone sit anywhere", async () => {
	seats = { minPlayers: 2, startedAt: null, closedAt: null, tournament: null, seats: [] };
	const c = room();
	expect(await seatFor(c, { id: ANN, name: "Ann" })).toBeUndefined();
	expect(() => requireOpenTable(c)).not.toThrow();
});

test("only a public open room goes on the room list", async () => {
	const open = { minPlayers: 2, startedAt: null, closedAt: null, tournament: null, seats: [] };
	for (const [visibility, listed] of [["public", true], ["private", false]] as const) {
		seats = { ...open, visibility };
		const c = room();
		await loadTournament(c);
		expect((c.vars as { listed?: boolean }).listed).toBe(listed);
	}
	seats = null; // a room the platform doesn't know
	const c = room();
	await loadTournament(c);
	expect((c.vars as { listed?: boolean }).listed).toBe(false);
});

test("nothing happens before the start time, even with everyone in", async () => {
	const c = room();
	await loadTournament(c);
	sit(c, ANN, BEN, CY);
	setSystemTime(START - 1000);
	const { calls, game } = runner(c);
	await tournamentTick(c, game);
	expect(calls.started).toBe(0);
});

test("starts at the start time once every assigned player is in", async () => {
	const c = room();
	await loadTournament(c);
	sit(c, ANN, BEN, CY);
	setSystemTime(START + 1000);
	const { calls, game } = runner(c);
	await tournamentTick(c, game);
	expect(calls.started).toBe(1);
	expect(marked).toEqual(["CUP01:start"]);
});

test("waits for late players, then starts with those present", async () => {
	const c = room();
	await loadTournament(c);
	sit(c, ANN, BEN);
	const { calls, game } = runner(c);
	setSystemTime(START + LATE_GRACE_MS - 1000);
	await tournamentTick(c, game);
	expect(calls.started).toBe(0);
	setSystemTime(START + LATE_GRACE_MS);
	await tournamentTick(c, game);
	expect(calls.started).toBe(1);
	expect(c.vars.game.players.map((p) => p.id)).toEqual([ANN, BEN]);
});

test("closes the table when fewer than the game's minimum came", async () => {
	const c = room();
	await loadTournament(c);
	sit(c, ANN);
	setSystemTime(START + LATE_GRACE_MS);
	const { calls, game } = runner(c);
	await tournamentTick(c, game);
	expect(calls.started).toBe(0);
	expect(c.vars.tournament.closed).toBe(true);
	expect(marked).toEqual(["CUP01:close"]);
	expect(seatFor(c, { id: BEN, name: "Ben" })).rejects.toThrow("This table has finished.");
});
