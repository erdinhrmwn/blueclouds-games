import type { SQL } from "bun";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { z } from "zod";
import { ok, validate } from "../lib/http";
import { playerAuth, serverAuth } from "../middleware/auth";
import { history, MatchReport, recordMatch } from "../services/matches";

const HistoryQuery = z.object({ cursor: z.uuid().optional() });

export function matchRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<AppEnv>();

	/** A room reports a finished game with its move log: 201 when stored, 200 for a retry of a stored match. */
	app.post("/matches", serverAuth(serverKey), validate("json", MatchReport), async (c) => {
		const report = c.req.valid("json");
		const created = await recordMatch(sql, report);
		const status = created ? 201 : 200;

		return ok(c, { match: { id: report.matchId, created } }, status);
	});

	/** The signed-in player's own history, newest first. */
	app.get("/players/me/matches", playerAuth(sql), validate("query", HistoryQuery), async (c) => {
		const { cursor } = c.req.valid("query");
		const page = await history(sql, c.get("player").id, cursor);

		return ok(c, page);
	});

	return app;
}
