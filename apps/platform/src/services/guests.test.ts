import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GUEST_UNUSED_DAYS, sweepGuests } from "./guests";
import { call, guest, room, SERVER_KEY, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
	t = await setupTestApp();
});
afterAll(async () => {
	await t.sql.close();
});

const exists = async (id: string) => (await t.sql`SELECT 1 FROM players WHERE id = ${id}`).length > 0;
const age = (id: string, days: number) => t.sql`UPDATE players SET last_seen_at = now() - make_interval(days => ${days}) WHERE id = ${id}`;
const logout = (secret: string) => call(t.app, "POST", "/v1/players/logout", { token: secret });

/** A finished match with this player in seat 0, reported the way the game's server does. */
async function playMatch(playerId: string, code: string) {
	await room(t.sql, "bust-31", code);
	const res = await call(t.app, "POST", "/v1/matches", {
		token: SERVER_KEY,
		body: {
			matchId: Bun.randomUUIDv7(),
			game: "bust-31",
			roomCode: code,
			rulesVersion: 1,
			startedAt: "2026-11-11T08:00:00Z",
			endedAt: "2026-11-11T08:06:12Z",
			players: [
				{ seat: 0, playerId, bot: false, placement: 1, score: 2 },
				{ seat: 1, playerId: null, bot: true, botName: "Bot Rain", placement: 2, score: 0 },
			],
			log: { logVersion: 1, events: [{ seq: 0, t: 0, type: "finished", data: { winner: 0 } }] },
		},
	});
	expect(res.status).toBe(201);
}

describe("guest cleanup", () => {
	test("logging out deletes a guest that never played, secrets and all", async () => {
		const g = await guest(t.app, "Lone");
		expect((await logout(g.secret)).status).toBe(200);
		expect(await exists(g.player.id)).toBe(false);
		const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM player_secrets WHERE player_id = ${g.player.id}`;
		expect(n).toBe(0);
	});

	test("logging out keeps a guest that is in a match, so other players' history stays whole", async () => {
		const g = await guest(t.app, "Played");
		await playMatch(g.player.id, "GSTA1");
		await logout(g.secret);
		expect(await exists(g.player.id)).toBe(true);
	});

	test("the sweep deletes only unused guests unseen for the limit; rooms they opened stay", async () => {
		const old = await guest(t.app, "Old");
		const fresh = await guest(t.app, "Fresh");
		const played = await guest(t.app, "Veteran");
		const account = await guest(t.app, "Acct");
		await call(t.app, "POST", "/v1/players/register", { token: account.secret, body: { name: "Acct", username: "acct_sweep", password: "long enough" } });
		await playMatch(played.player.id, "GSTB1");
		const roomId = await room(t.sql, "bust-31", "GSTC1");
		await t.sql`UPDATE rooms SET created_by_player_id = ${old.player.id} WHERE id = ${roomId}`;
		for (const p of [old, played, account]) await age(p.player.id, GUEST_UNUSED_DAYS + 1);
		await age(fresh.player.id, GUEST_UNUSED_DAYS - 1);

		expect(await sweepGuests(t.sql)).toBeGreaterThanOrEqual(1);
		expect(await exists(old.player.id)).toBe(false);
		expect([await exists(fresh.player.id), await exists(played.player.id), await exists(account.player.id)]).toEqual([true, true, true]);
		const [r] = await t.sql`SELECT created_by_player_id FROM rooms WHERE id = ${roomId}`;
		expect(r.created_by_player_id).toBeNull();
	});

	test("asking who you are counts as being seen", async () => {
		const g = await guest(t.app, "Visitor");
		await age(g.player.id, GUEST_UNUSED_DAYS + 1);
		await call(t.app, "GET", "/v1/players/me", { token: g.secret });
		await sweepGuests(t.sql);
		expect(await exists(g.player.id)).toBe(true);
	});
});
