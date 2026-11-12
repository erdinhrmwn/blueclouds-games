import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { call, resetTestDatabase, room, setupTestApp } from "../test-helpers";

// Rules the database holds on its own (docs/architecture/database.md), checked with plain SQL.
let sql: SQL;
let player: string;
let admin: string;
let roomId: string;
const MATCH = "01900000-0000-7000-8000-000000000001";
const hash = () => crypto.getRandomValues(new Uint8Array(32));

beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	[{ id: player }] = await sql`INSERT INTO players (display_name) VALUES ('Rina') RETURNING id`;
	[{ id: admin }] =
		await sql`INSERT INTO admins (username, password_hash) VALUES ('root', '$argon2id$v=19$test') RETURNING id`;
	roomId = await room(sql, "bust-31", "ABCD");
	await sql`INSERT INTO matches (id, game_slug, room_id, rules_version, started_at, ended_at, body_hash)
	          VALUES (${MATCH}, 'bust-31', ${roomId}, 1, now() - interval '5 min', now(), ${hash()})`;
	await sql`INSERT INTO match_players (match_id, seat, player_id, bot_name, placement, score)
	          VALUES (${MATCH}, 0, ${player}, NULL, 1, 2), (${MATCH}, 1, NULL, 'Bot Rain', 2, 0)`;
	await sql`INSERT INTO match_logs (match_id, log_version, event_count, events) VALUES (${MATCH}, 1, 1, '[{"seq":0}]')`;
	await sql`INSERT INTO admin_audit_events (admin_id, action) VALUES (${admin}, 'login')`;
});
afterAll(() => sql.close());

const refused = (query: Promise<unknown>, message: RegExp) =>
	expect(query).rejects.toThrow(message);

describe("append-only history", () => {
	for (const table of ["matches", "match_players", "match_logs", "admin_audit_events"]) {
		test(`${table}: UPDATE and DELETE are refused`, async () => {
			await refused(sql.unsafe(`UPDATE ${table} SET created_at = now()`), /append-only/);
			await refused(sql.unsafe(`DELETE FROM ${table}`), /append-only/);
		});
	}
});

describe("match rules", () => {
	test("a second winner or a player in two seats is refused", async () => {
		await refused(
			sql`INSERT INTO match_players (match_id, seat, player_id, bot_name, placement, score) VALUES (${MATCH}, 2, NULL, 'Bot Sun', 1, 0)`,
			/winner_key/,
		);
		await refused(
			sql`INSERT INTO match_players (match_id, seat, player_id, bot_name, placement, score) VALUES (${MATCH}, 2, ${player}, NULL, 3, 0)`,
			/player_id_match_id_key/,
		);
	});

	test("a non-v7 id, a short hash or a wrong event count is refused", async () => {
		const insert = (id: string, h: Uint8Array) =>
			sql`INSERT INTO matches (id, game_slug, room_id, rules_version, started_at, ended_at, body_hash) VALUES (${id}, 'bust-31', ${roomId}, 1, now(), now(), ${h})`;
		await refused(insert("01900000-0000-4000-8000-000000000002", hash()), /matches_id_check/);
		await refused(
			insert("01900000-0000-7000-8000-000000000002", new Uint8Array(1)),
			/matches_body_hash_check/,
		);
		await insert("01900000-0000-7000-8000-000000000003", hash());
		await refused(
			sql`INSERT INTO match_logs (match_id, log_version, event_count, events) VALUES ('01900000-0000-7000-8000-000000000003', 1, 2, '[{"seq":0}]')`,
			/events_length_check/,
		);
	});
});

describe("admins and audit", () => {
	test("root cannot be disabled, another admin can", async () => {
		await refused(
			sql`UPDATE admins SET disabled_at = now() WHERE username = 'root'`,
			/root_enabled_check/,
		);
		await sql`INSERT INTO admins (username, password_hash) VALUES ('ops', '$argon2id$v=19$test')`;
		await sql`UPDATE admins SET disabled_at = now() WHERE username = 'ops'`;
	});

	test("a password that isn't an argon2id hash is refused", async () => {
		await refused(
			sql`INSERT INTO admins (username, password_hash) VALUES ('plain', 'hunter2')`,
			/password_hash_check/,
		);
	});

	test("an unknown audit action is refused", async () => {
		await refused(
			sql`INSERT INTO admin_audit_events (admin_id, action) VALUES (${admin}, 'player.delete')`,
			/action_check/,
		);
	});
});

describe("tournament rooms", () => {
	let cup: string;
	let cupRoom: string;
	let other: string;
	beforeAll(async () => {
		[{ id: cup }] = await sql`
			INSERT INTO tournaments (game_slug, name, players_per_room, starts_at, registration_closes_at, created_by_admin_id)
			VALUES ('bust-31', 'Cup', 6, now() + interval '1 hour', now() + interval '50 min', ${admin}) RETURNING id`;
		[{ id: cupRoom }] =
			await sql`INSERT INTO rooms (game_slug, code, tournament_id) VALUES ('bust-31', 'CUP01', ${cup}) RETURNING id`;
		[{ id: other }] = await sql`INSERT INTO players (display_name) VALUES ('Ben') RETURNING id`;
		await sql`INSERT INTO tournament_players (tournament_id, player_id) VALUES (${cup}, ${player}), (${cup}, ${other})`;
		await sql`INSERT INTO room_assignments (room_id, tournament_id, player_id, seat) VALUES (${cupRoom}, ${cup}, ${player}, 0)`;
	});
	const assign = (roomId: string, playerId: string, seat: number) =>
		sql`INSERT INTO room_assignments (room_id, tournament_id, player_id, seat) VALUES (${roomId}, ${cup}, ${playerId}, ${seat})`;

	test("a player can't make one, and it plays its tournament's game", async () => {
		await refused(
			sql`INSERT INTO rooms (game_slug, code, tournament_id, created_by_player_id) VALUES ('bust-31', 'CUP02', ${cup}, ${player})`,
			/tournament_creator_check/,
		);
		await refused(
			sql`INSERT INTO rooms (game_slug, code, tournament_id) VALUES ('cloudburst', 'CUP03', ${cup})`,
			/tournament_id_game_slug_fkey/,
		);
	});

	test("one player per seat, only registered players, one room per player per tournament", async () => {
		await refused(assign(cupRoom, other, 0), /room_id_seat_key/);
		const [{ id: stranger }] =
			await sql`INSERT INTO players (display_name) VALUES ('Cy') RETURNING id`;
		await refused(assign(cupRoom, stranger, 1), /tournament_id_player_id_fkey/);
		const [{ id: second }] =
			await sql`INSERT INTO rooms (game_slug, code, tournament_id) VALUES ('bust-31', 'CUP04', ${cup}) RETURNING id`;
		await refused(assign(second, player, 0), /tournament_id_player_id_key/);
	});

	test("an open room takes no assignments", async () => {
		await refused(assign(roomId, other, 1), /room_id_tournament_id_fkey/);
	});
});

describe("player names", () => {
	test("the database refuses a name with a newline or untrimmed spaces", async () => {
		await refused(
			sql`INSERT INTO players (display_name) VALUES (${"Rina\n"})`,
			/display_name_check/,
		);
		await refused(sql`INSERT INTO players (display_name) VALUES (' Rina')`, /display_name_check/);
	});

	test("guests (no password) have guest_ usernames, accounts don't; is_active and is_guest can't be written", async () => {
		await refused(
			sql`INSERT INTO players (display_name, username) VALUES ('Lu', 'lu')`,
			/players_guest_username_check/,
		);
		await refused(
			sql`INSERT INTO players (display_name, username, password_hash) VALUES ('Lu', 'guest_lu', '$argon2id$x')`,
			/players_guest_username_check/,
		);
		const [g] =
			await sql`INSERT INTO players (display_name, username) VALUES ('Guest 1', 'guest_000001') RETURNING is_guest`;
		expect(g.is_guest).toBe(true);
		await refused(sql`UPDATE players SET is_guest = false WHERE id = ${player}`, /is_guest/);
		await refused(
			sql`INSERT INTO players (display_name, username, password_hash) VALUES ('Lu', 'Lu', '$argon2id$x')`,
			/players_username_check/,
		);
		await refused(sql`UPDATE players SET is_active = false WHERE id = ${player}`, /is_active/);
	});

	test("the API answers 400 for the same name instead of hitting the constraint", async () => {
		const t = await setupTestApp();
		try {
			const res = await call(t.app, "POST", "/v1/players/guest", {
				body: { name: "Ri\nna" },
				headers: { "x-forwarded-for": "10.0.0.7" },
			});
			expect(res.status).toBe(400);
			expect(res.json.error.fields).toEqual({ name: "Must not contain control characters." });
		} finally {
			await t.sql.close();
		}
	});
});
