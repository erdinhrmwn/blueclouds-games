import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newRoomCode } from "../services/rooms";
import { call, guest, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let ann: Awaited<ReturnType<typeof guest>>;
let bob: Awaited<ReturnType<typeof guest>>;
beforeAll(async () => {
	t = await setupTestApp();
	ann = await guest(t.app, "Ann");
	bob = await guest(t.app, "Bob");
});
afterAll(() => t.sql.close());

const open = (game: string, token = ann.secret, visibility?: string) =>
	call(t.app, "POST", "/v1/rooms", {
		body: { game, visibility },
		token,
		headers: { "x-forwarded-for": "10.1.0.1" },
	});
const enter = (code: string, token: string) => call(t.app, "GET", `/v1/rooms/${code}`, { token });
const invite = (code: string, token = ann.secret) =>
	call(t.app, "POST", `/v1/rooms/${code}/invites`, {
		token,
		headers: { "x-forwarded-for": "10.1.0.2" },
	});
const redeem = (secret: string, token = bob.secret, ip = "10.1.0.3") =>
	call(t.app, "POST", "/v1/invites/redeem", {
		body: { invite: secret },
		token,
		headers: { "x-forwarded-for": ip },
	});

describe("rooms", () => {
	test("codes are 8 characters without 0/O/1/I", () => {
		for (let i = 0; i < 200; i++) expect(newRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
	});

	test("a player opens a table and the platform picks a unique code", async () => {
		const a = await open("bust-31");
		const b = await open("cloudburst");
		expect(a.status).toBe(201);
		expect(a.json.data.room).toMatchObject({ game: "bust-31" });
		expect(a.json.data.room.code).not.toBe(b.json.data.room.code);
		const [row] =
			await t.sql`SELECT created_by_player_id FROM rooms WHERE code = ${a.json.data.room.code}`;
		expect(row.created_by_player_id).toBe(ann.player.id);
	});

	test("needs a player and a known game", async () => {
		expect((await call(t.app, "POST", "/v1/rooms", { body: { game: "bust-31" } })).status).toBe(
			401,
		);
		expect((await open("chess")).json.error.fields).toEqual({ game: "Unknown game." });
	});

	test("join by code: a known code answers with its game, an unknown one is 404", async () => {
		const { code } = (await open("bust-31")).json.data.room;
		const found = await call(t.app, "GET", `/v1/rooms/${code}`, { token: ann.secret });
		expect(found.json.data.room).toMatchObject({ code, game: "bust-31" });
		expect((await call(t.app, "GET", "/v1/rooms/ZZZZZ", { token: ann.secret })).status).toBe(404);
		expect((await call(t.app, "GET", "/v1/rooms/bad!", { token: ann.secret })).status).toBe(400);
	});

	test("a new table is private: only its opener may enter; a public one lets anyone in", async () => {
		const { room } = (await open("bust-31")).json.data;
		expect(room.visibility).toBe("private");
		expect((await enter(room.code, ann.secret)).status).toBe(200);
		const refused = await enter(room.code, bob.secret);
		expect(refused.status).toBe(403);
		expect(refused.json.error.message).toBe(
			"This table is private. Ask a player there for an invite.",
		);
		const pub = (await open("bust-31", ann.secret, "public")).json.data.room;
		expect((await enter(pub.code, bob.secret)).json.data.room).toMatchObject({
			code: pub.code,
			visibility: "public",
		});
		expect((await open("bust-31", ann.secret, "secret")).status).toBe(400);
	});

	test("an invite link lets a friend in; the opener can reset it, which kills the old one", async () => {
		const { code } = (await open("bust-31")).json.data.room;
		expect((await invite(code, bob.secret)).status).toBe(403); // not a member yet
		const first = (await invite(code)).json.data.invite.token;
		expect(first).toMatch(/^[0-9a-f]{32}$/);
		expect((await invite(code)).json.data.invite.token).toBe(first); // one live link per room
		expect((await redeem(first)).json.data.room).toEqual({ code, game: "bust-31" });
		expect((await enter(code, bob.secret)).status).toBe(200);
		expect((await redeem(first)).status).toBe(200); // redeeming twice is fine

		expect(
			(await call(t.app, "DELETE", `/v1/rooms/${code}/invites/link`, { token: bob.secret })).status,
		).toBe(403);
		expect(
			(await call(t.app, "DELETE", `/v1/rooms/${code}/invites/link`, { token: ann.secret })).status,
		).toBe(200);
		const cy = await guest(t.app, "Cy");
		expect((await redeem(first, cy.secret)).status).toBe(404);
		const second = (await invite(code)).json.data.invite.token;
		expect(second).not.toBe(first);
		expect((await redeem(second, cy.secret)).status).toBe(200);
	});

	test("redeeming is rate-limited per IP and takes only link tokens", async () => {
		const unknown = "0".repeat(32);
		for (let i = 0; i < 10; i++) {
			expect((await redeem(unknown, bob.secret, "10.9.9.9")).status).toBe(404);
		}
		expect((await redeem(unknown, bob.secret, "10.9.9.9")).status).toBe(429);
		expect((await redeem("ZZZZZZ", bob.secret, "10.9.9.8")).status).toBe(400); // an old-style code
		expect((await redeem("bad invite!", bob.secret, "10.9.9.8")).status).toBe(400);
	});
});
