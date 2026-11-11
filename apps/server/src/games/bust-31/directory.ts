import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { isInternal } from "../../platform";
import { RoomCode, RoomSummary } from "./schema";

/** Rooms nobody has touched for this long are dropped, in case a room never said goodbye. */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * The list of open Bust 31 tables, for the "Open tables" section. One instance (key ["main"]).
 * Rooms report themselves whenever they change and remove themselves when nobody is connected.
 * Browsers may only `list`; `report` and `remove` need the internal actor key.
 */
export const bust31Rooms = actor({
	db: db({
		onMigrate: async (d) => {
			await d.execute("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)");
		},
	}),
	actions: {
		list: async (c) => listRooms(c),
		/** Room actors only. */
		report: async (c, input: unknown) => {
			requireInternal(c);
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
		/** Room actors only. */
		remove: async (c, code: unknown) => {
			requireInternal(c);
			const parsed = RoomCode.safeParse(code);
			if (!parsed.success) throw new UserError("Invalid room code.", { code: "bad_input" });
			await c.db.execute("DELETE FROM rooms WHERE code = ?", parsed.data);
			c.broadcast("rooms", await listRooms(c));
		},
	},
});

// Same reason as in actor.ts: rivetkit's context generics are long.
function requireInternal(c: any): void {
	if (!isInternal(c.conn.params)) throw new UserError("Not allowed.", { code: "forbidden" });
}

async function listRooms(c: any): Promise<RoomSummary[]> {
	await c.db.execute("DELETE FROM rooms WHERE updated_at < ?", Date.now() - STALE_MS);
	const rows = await c.db.execute("SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 50");
	return rows.map((r: { data: string }) => JSON.parse(r.data) as RoomSummary);
}
