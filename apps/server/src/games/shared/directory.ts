import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { RoomCode, RoomSummary } from "./schema";

/** Rooms nobody has touched for this long are dropped, in case a room never said goodbye. */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * The list of open tables of one game, for its "Open tables" section. One instance per game, keyed by slug.
 * Rooms report themselves whenever they change and remove themselves when nobody is connected.
 * Browsers can't reach it: their engine tokens only reach one room. The game's server reads the list.
 */
export const roomList = actor({
	options: { name: "Room List", icon: "list" }, // shown in the Rivet dashboard
	db: db({
		onMigrate: async (d) => {
			await d.execute("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)");
		},
	}),
	actions: {
		list: async (c) => listRooms(c),
		report: async (c, input: unknown) => {
			const parsed = RoomSummary.safeParse(input);
			if (!parsed.success) throw new UserError("Invalid room summary.", { code: "bad_input" });
			await c.db.execute(
				"INSERT INTO rooms (code, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
				parsed.data.code,
				JSON.stringify(parsed.data),
				Date.now(),
			);
			c.broadcast("rooms", await listRooms(c));
		},
		remove: async (c, code: unknown) => {
			const parsed = RoomCode.safeParse(code);
			if (!parsed.success) throw new UserError("Invalid room code.", { code: "bad_input" });
			await c.db.execute("DELETE FROM rooms WHERE code = ?", parsed.data);
			c.broadcast("rooms", await listRooms(c));
		},
	},
});

// Same reason as in actor.ts: rivetkit's context generics are long.
async function listRooms(c: any): Promise<RoomSummary[]> {
	await c.db.execute("DELETE FROM rooms WHERE updated_at < ?", Date.now() - STALE_MS);
	const rows = await c.db.execute("SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 50");
	return rows.map((r: { data: string }) => JSON.parse(r.data) as RoomSummary);
}
