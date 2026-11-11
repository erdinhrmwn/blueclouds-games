import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newRoomCode } from "./rooms";
import { call, guest, setupTestApp } from "./test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let ann: Awaited<ReturnType<typeof guest>>;
beforeAll(async () => {
	t = await setupTestApp();
	ann = await guest(t.app, "Ann");
});
afterAll(() => t.sql.close());

const open = (game: string, token = ann.secret) =>
	call(t.app, "POST", "/v1/rooms", { body: { game }, token, headers: { "x-forwarded-for": "10.1.0.1" } });

describe("rooms", () => {
	test("codes are 5 characters without 0/O/1/I", () => {
		for (let i = 0; i < 200; i++) expect(newRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
	});

	test("a player opens a table and the platform picks a unique code", async () => {
		const a = await open("bust-31");
		const b = await open("cloudburst");
		expect(a.status).toBe(201);
		expect(a.json.data.room).toMatchObject({ game: "bust-31" });
		expect(a.json.data.room.code).not.toBe(b.json.data.room.code);
		const [row] = await t.sql`SELECT created_by_player_id FROM rooms WHERE code = ${a.json.data.room.code}`;
		expect(row.created_by_player_id).toBe(ann.player.id);
	});

	test("needs a player and a known game", async () => {
		expect((await call(t.app, "POST", "/v1/rooms", { body: { game: "bust-31" } })).status).toBe(401);
		expect((await open("chess")).json.error.fields).toEqual({ game: "Unknown game." });
	});

	test("join by code: a known code answers with its game, an unknown one is 404", async () => {
		const { code } = (await open("bust-31")).json.data.room;
		const found = await call(t.app, "GET", `/v1/rooms/${code}`, { token: ann.secret });
		expect(found.json.data.room).toMatchObject({ code, game: "bust-31" });
		expect((await call(t.app, "GET", "/v1/rooms/ZZZZZ", { token: ann.secret })).status).toBe(404);
		expect((await call(t.app, "GET", "/v1/rooms/bad!", { token: ann.secret })).status).toBe(400);
	});
});
