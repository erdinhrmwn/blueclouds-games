import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { jwtVerify } from "jose";
import { PLAY_TOKEN_AUDIENCE } from "../lib/play-tokens";
import { call, guest, SERVER_KEY, setupTestApp } from "../test-helpers";

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
		const [row] =
			await t.sql`SELECT count(*)::int AS n FROM player_secrets WHERE player_id = ${res.json.data.player.id}`;
		expect(row.n).toBe(1);
	});

	test('without a name, makes up "Guest 123456" with username guest_123456', async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", {
			body: {},
			headers: { "x-forwarded-for": "10.0.0.10" },
		});
		expect(res.status).toBe(201);
		const { name, username, guest } = res.json.data.player;
		expect(name).toMatch(/^Guest \d{6}$/);
		expect(username).toBe(`guest_${name.slice(6)}`);
		expect(guest).toBe(true);
		// a guest has no password, so its username can't be used to log in
		const login = await call(t.app, "POST", "/v1/players/login", {
			body: { username, password: "anything1" },
			headers: { "x-forwarded-for": "10.0.0.10" },
		});
		expect(login.status).toBe(401);
	});

	test("rejects a bad name with field errors", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", {
			body: { name: "" },
			headers: { "x-forwarded-for": "10.0.0.9" },
		});
		expect(res.status).toBe(400);
		expect(res.json).toEqual({
			ok: false,
			data: null,
			error: {
				code: "bad_input",
				message: "Some fields are invalid.",
				fields: { name: "Must be 1–20 characters." },
			},
		});
	});

	test("rejects a body that is not JSON", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", {
			body: "{nope",
			headers: { "x-forwarded-for": "10.0.0.8" },
		});
		expect(res.status).toBe(400);
		expect(res.json.error.code).toBe("bad_input");
	});

	test("rate limits guest creation per IP", async () => {
		const ip = { "x-forwarded-for": "10.0.0.1" };
		for (let i = 0; i < 5; i++)
			expect(
				(await call(t.app, "POST", "/v1/players/guest", { body: { name: "A" }, headers: ip }))
					.status,
			).toBe(201);
		const res = await call(t.app, "POST", "/v1/players/guest", {
			body: { name: "A" },
			headers: ip,
		});
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

	test("returns the current player; only an account can rename", async () => {
		const { player, secret } = await guest(t.app);
		expect(
			(await call(t.app, "GET", "/v1/players/me", { token: secret })).json.data.player,
		).toEqual(expect.objectContaining({ id: player.id, name: "Rina" }));
		const refused = await call(t.app, "PATCH", "/v1/players/me", {
			token: secret,
			body: { name: "Rina K" },
		});
		expect(refused.status).toBe(403);
		expect(refused.json.error.code).toBe("forbidden");

		const body = { name: "Rina", username: `rina_${player.id.slice(-8)}`, password: "long enough" };
		const headers = { "x-forwarded-for": crypto.randomUUID() };
		expect(
			(await call(t.app, "POST", "/v1/players/register", { token: secret, body, headers })).status,
		).toBe(200);
		const renamed = await call(t.app, "PATCH", "/v1/players/me", {
			token: secret,
			body: { name: "Rina K" },
		});
		expect(renamed.status).toBe(200);
		expect(renamed.json.data.player.name).toBe("Rina K");
	});

	test("disabled player and revoked secret are refused", async () => {
		const a = await guest(t.app);
		await t.sql`UPDATE players SET disabled_at = now(), disabled_reason = 'Test' WHERE id = ${a.player.id}`;
		const disabled = await call(t.app, "GET", "/v1/players/me", { token: a.secret });
		expect(disabled.status).toBe(403);
		expect(disabled.json.error.code).toBe("forbidden");
		// The backoffice also revokes their secrets; they still learn they were disabled.
		await t.sql`UPDATE player_secrets SET revoked_at = now() WHERE player_id = ${a.player.id}`;
		expect((await call(t.app, "GET", "/v1/players/me", { token: a.secret })).status).toBe(403);

		const b = await guest(t.app);
		await t.sql`UPDATE player_secrets SET revoked_at = now() WHERE player_id = ${b.player.id}`;
		expect((await call(t.app, "GET", "/v1/players/me", { token: b.secret })).status).toBe(401);
	});

	test("updated_at moves on update", async () => {
		const { player } = await guest(t.app);
		const [before] = await t.sql`SELECT updated_at FROM players WHERE id = ${player.id}`;
		await Bun.sleep(5);
		await t.sql`UPDATE players SET display_name = 'New' WHERE id = ${player.id}`;
		const [after] = await t.sql`SELECT updated_at FROM players WHERE id = ${player.id}`;
		expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
	});
});

describe("play tokens", () => {
	test("signs a 15-minute token the actors can verify", async () => {
		const { player, secret } = await guest(t.app, "Bima");
		const res = await call(t.app, "POST", "/v1/play-tokens", { token: secret });
		expect(res.status).toBe(200);
		const { payload } = await jwtVerify(res.json.data.token, t.publicKey, {
			audience: PLAY_TOKEN_AUDIENCE,
			algorithms: ["EdDSA"],
		});
		expect(payload.sub).toBe(player.id);
		expect(payload.name).toBe("Bima");
		expect(payload.vip).toBe(false);
		expect(payload.exp! - payload.iat!).toBe(15 * 60);
		expect(new Date(res.json.data.expiresAt).getTime()).toBe(payload.exp! * 1000);
	});

	test("tells the actors a VIP is one", async () => {
		const { player, secret } = await guest(t.app);
		await t.sql`UPDATE players SET is_vip = true WHERE id = ${player.id}`;

		const res = await call(t.app, "POST", "/v1/play-tokens", { token: secret });
		const { payload } = await jwtVerify(res.json.data.token, t.publicKey, {
			audience: PLAY_TOKEN_AUDIENCE,
			algorithms: ["EdDSA"],
		});

		expect(payload.vip).toBe(true);
	});

	test("tells a room which of its players are VIP, with the server key only", async () => {
		const vip = await guest(t.app);
		const plain = await guest(t.app);
		await t.sql`UPDATE players SET is_vip = true WHERE id = ${vip.player.id}`;

		const path = `/v1/players/vips?ids=${vip.player.id},${plain.player.id}`;
		const res = await call(t.app, "GET", path, { token: SERVER_KEY });

		expect(res.status).toBe(200);
		expect(res.json.data.vipIds).toEqual([vip.player.id]);
		expect((await call(t.app, "GET", path, { token: vip.secret })).status).toBe(401);
		expect(
			(await call(t.app, "GET", "/v1/players/vips?ids=nope", { token: SERVER_KEY })).status,
		).toBe(400);
	});

	test("disabled player cannot get a token", async () => {
		const { player, secret } = await guest(t.app);
		await t.sql`UPDATE players SET disabled_at = now(), disabled_reason = 'Test' WHERE id = ${player.id}`;
		expect((await call(t.app, "POST", "/v1/play-tokens", { token: secret })).status).toBe(403);
	});
});

describe("accounts", () => {
	const ip = () => ({ "x-forwarded-for": crypto.randomUUID() });
	const register = (body: unknown, token?: string) =>
		call(t.app, "POST", "/v1/players/register", { body, token, headers: ip() });
	const login = (username: string, password: string) =>
		call(t.app, "POST", "/v1/players/login", { body: { username, password }, headers: ip() });

	test("a guest registers in place: same id, same secret, history kept", async () => {
		const g = await guest(t.app, "Gina");
		const res = await register(
			{ name: "Gina", username: "Gina_01", password: "long enough" },
			g.secret,
		);
		expect(res.status).toBe(200);
		expect(res.json.data.player).toMatchObject({
			id: g.player.id,
			username: "gina_01",
			guest: false,
		});
		expect(res.json.data.playerSecret).toBeUndefined();
		expect(
			(await call(t.app, "GET", "/v1/players/me", { token: g.secret })).json.data.player.username,
		).toBe("gina_01");
		expect(
			(await register({ name: "Gina", username: "gina_02", password: "long enough" }, g.secret))
				.status,
		).toBe(409);
		const [row] =
			await t.sql`SELECT password_hash, is_active, is_bot, is_vip FROM players WHERE id = ${g.player.id}`;
		expect(row.password_hash).toStartWith("$argon2id$");
		expect([row.is_active, row.is_bot, row.is_vip]).toEqual([true, false, false]);
	});

	test("without a guest, register makes a new player; a taken or bad username is refused", async () => {
		const res = await register({ name: "Hana", username: "hana", password: "long enough" });
		expect(res.status).toBe(201);
		expect(res.json.data.playerSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const taken = await register({ name: "Other", username: "HANA", password: "long enough" });
		expect([taken.status, taken.json.error.fields]).toEqual([
			409,
			{ username: "That username is taken." },
		]);
		const reserved = await register({ name: "Y", username: "Guest_1", password: "long enough" });
		expect(reserved.json.error.fields).toEqual({
			username: 'Usernames starting with "guest" are kept for guests.',
		});
		const bad = await register({ name: "X", username: "a b", password: "short" });
		expect(Object.keys(bad.json.error.fields).sort()).toEqual(["password", "username"]);
	});

	test("login gives this device its own secret; logout revokes only that one", async () => {
		const first = (await register({ name: "Ira", username: "ira", password: "correct horse" })).json
			.data;
		expect((await login("IRA", "wrong horse")).status).toBe(401);
		const res = await login("ira", "correct horse");
		expect(res.json.data.player).toMatchObject({
			id: first.player.id,
			name: "Ira",
			username: "ira",
		});
		const second = res.json.data.playerSecret;
		expect(second).not.toBe(first.playerSecret);
		expect((await call(t.app, "POST", "/v1/players/logout", { token: second })).status).toBe(200);
		expect((await call(t.app, "GET", "/v1/players/me", { token: second })).status).toBe(401);
		expect((await call(t.app, "GET", "/v1/players/me", { token: first.playerSecret })).status).toBe(
			200,
		);
	});

	test("an unknown username answers like a wrong password; 5 wrong ones lock the username", async () => {
		expect((await login("nobody", "whatever1")).json.error.message).toBe(
			"Wrong username or password.",
		);
		await register({ name: "Jo", username: "jo", password: "right password" });
		for (let i = 0; i < 5; i++) await login("jo", "wrong password");
		const locked = await login("jo", "right password");
		expect([locked.status, locked.json.error.message]).toEqual([
			429,
			"Too many wrong passwords. Try again in 15 minutes.",
		]);
	});

	test("a disabled player can't sign in; is_active follows disabled_at", async () => {
		const { player } = (
			await register({ name: "Kai", username: "kai", password: "right password" })
		).json.data;
		await t.sql`UPDATE players SET disabled_at = now(), disabled_reason = 'Test' WHERE id = ${player.id}`;
		expect((await login("kai", "right password")).status).toBe(403);
		expect((await t.sql`SELECT is_active FROM players WHERE id = ${player.id}`)[0].is_active).toBe(
			false,
		);
	});
});
