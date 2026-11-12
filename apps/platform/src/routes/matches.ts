import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { ok, parse, readJson } from "../lib/http";
import { playerAuth, type PlayerVariables, serverAuth } from "../middleware/auth";
import { history, MatchReport, recordMatch } from "../services/matches";

const HistoryQuery = z.object({ cursor: z.uuid().optional() });

export function matchRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<{ Variables: PlayerVariables }>();

	/** A room reports a finished game with its move log: 201 when stored, 200 for a retry of a stored match. */
	app.post("/matches", serverAuth(serverKey), async (c) => {
		const m = parse(MatchReport, await readJson(c));
		const created = await recordMatch(sql, m);
		return ok(c, { match: { id: m.matchId, created } }, created ? 201 : 200);
	});

	/** The signed-in player's own history, newest first. */
	app.get("/players/me/matches", playerAuth(sql), async (c) => {
		const { cursor } = parse(HistoryQuery, c.req.query());
		return ok(c, await history(sql, c.get("player").id, cursor));
	});

	return app;
}
