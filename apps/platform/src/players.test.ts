import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { jwtVerify } from "jose";
import { PLAY_TOKEN_AUDIENCE } from "./tokens";
import { call, guest, setupTestApp } from "./test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
	t = await setupTestApp();
});
afterAll(async () => {
	await t.sql.close();
});

describe("guest players", () => {
	test("creates a player and returns its secret once", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", { body: { name: "  Rina  " } });
		expect(res.status).toBe(201);
		expect(res.json.ok).toBe(true);
		expect(res.json.data.player.name).toBe("Rina");
		expect(res.json.data.player.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(res.json.data.playerSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const [row] = await t.sql`SELECT count(*)::int AS n FROM player_secrets WHERE player_id = ${res.json.data.player.id}`;
		expect(row.n).toBe(1);
	});

	test("rejects a bad name with field errors", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", { body: { name: "" }, headers: { "x-forwarded-for": "10.0.0.9" } });
		expect(res.status).toBe(400);
		expect(res.json).toEqual({
			ok: false,
			data: null,
			error: { code: "bad_input", message: "Some fields are invalid.", fields: { name: "Must be 1–20 characters." } },
		});
	});

	test("rejects a body that is not JSON", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", { body: "{nope", headers: { "x-forwarded-for": "10.0.0.8" } });
		expect(res.status).toBe(400);
		expect(res.json.error.code).toBe("bad_input");
	});

	test("rate limits guest creation per IP", async () => {
		const ip = { "x-forwarded-for": "10.0.0.1" };
		for (let i = 0; i < 5; i++) expect((await call(t.app, "POST", "/v1/players/guest", { body: { name: "A" }, headers: ip })).status).toBe(201);
		const res = await call(t.app, "POST", "/v1/players/guest", { body: { name: "A" }, headers: ip });
		expect(res.status).toBe(429);
		expect(res.json.error.code).toBe("rate_limited");
		expect(res.headers.get("retry-after")).toBeTruthy();
	});
});

describe("me", () => {
	test("needs a valid secret", async () => {
		expect((await call(t.app, "GET", "/v1/players/me")).json.error.code).toBe("unauthenticated");
		const res = await call(t.app, "GET", "/v1/players/me", { token: "A".repeat(43) });
		expect(res.status).toBe(401);
	});

	test("returns and renames the current player", async () => {
		const { player, secret } = await guest(t.app);
		expect((await call(t.app, "GET", "/v1/players/me", { token: secret })).json.data.player).toEqual(
			expect.objectContaining({ id: player.id, name: "Rina" }),
		);
		const renamed = await call(t.app, "PATCH", "/v1/players/me", { token: secret, body: { name: "Rina K" } });
		expect(renamed.status).toBe(200);
		expect(renamed.json.data.player.name).toBe("Rina K");
	});

	test("disabled player and revoked secret are refused", async () => {
		const a = await guest(t.app);
		await t.sql`UPDATE players SET disabled_at = now() WHERE id = ${a.player.id}`;
		const disabled = await call(t.app, "GET", "/v1/players/me", { token: a.secret });
		expect(disabled.status).toBe(403);
		expect(disabled.json.error.code).toBe("forbidden");

		const b = await guest(t.app);
		await t.sql`UPDATE player_secrets SET revoked_at = now() WHERE player_id = ${b.player.id}`;
		expect((await call(t.app, "GET", "/v1/players/me", { token: b.secret })).status).toBe(401);
	});

	test("updated_at moves on update", async () => {
		const { player, secret } = await guest(t.app);
		const [before] = await t.sql`SELECT updated_at FROM players WHERE id = ${player.id}`;
		await Bun.sleep(5);
		await call(t.app, "PATCH", "/v1/players/me", { token: secret, body: { name: "New" } });
		const [after] = await t.sql`SELECT updated_at FROM players WHERE id = ${player.id}`;
		expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
	});
});

describe("play tokens", () => {
	test("signs a 15-minute token the actors can verify", async () => {
		const { player, secret } = await guest(t.app, "Bima");
		const res = await call(t.app, "POST", "/v1/play-tokens", { token: secret });
		expect(res.status).toBe(200);
		const { payload } = await jwtVerify(res.json.data.token, t.publicKey, { audience: PLAY_TOKEN_AUDIENCE, algorithms: ["EdDSA"] });
		expect(payload.sub).toBe(player.id);
		expect(payload.name).toBe("Bima");
		expect(payload.exp! - payload.iat!).toBe(15 * 60);
		expect(new Date(res.json.data.expiresAt).getTime()).toBe(payload.exp! * 1000);
	});

	test("disabled player cannot get a token", async () => {
		const { player, secret } = await guest(t.app);
		await t.sql`UPDATE players SET disabled_at = now() WHERE id = ${player.id}`;
		expect((await call(t.app, "POST", "/v1/play-tokens", { token: secret })).status).toBe(403);
	});
});
