import type { SQL } from "bun";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { z } from "zod";
import { ApiError, ok, validate } from "../lib/http";
import { playerAuth, serverAuth } from "../middleware/auth";
import { history, MatchReport, recordMatch, stats } from "../services/matches";
import { matchRounds, recordRound, RoundReport } from "../services/rounds";

const HistoryQuery = z.object({ cursor: z.uuid().optional() });
const MatchParam = z.object({ id: z.uuidv7("Not a match id.") });

export function matchRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<AppEnv>();

	/** A room reports a finished game with its move log: 201 when stored, 200 for a retry of a stored match. */
	app.post("/matches", serverAuth(serverKey), validate("json", MatchReport), async (c) => {
		const report = c.req.valid("json");
		const created = await recordMatch(sql, report);
		const status = created ? 201 : 200;

		return ok(c, { match: { id: report.matchId, created } }, status);
	});

	/** A room reports a round it closed: 201 when stored, 200 for a retry of a stored round. */
	app.post(
		"/matches/:id/rounds",
		serverAuth(serverKey),
		validate("param", MatchParam),
		validate("json", RoundReport),
		async (c) => {
			const { id } = c.req.valid("param");
			const round = c.req.valid("json");
			const created = await recordRound(sql, id, round);
			const status = created ? 201 : 200;

			return ok(c, { round: { matchId: id, round: round.round, created } }, status);
		},
	);

	/** A match's rounds, running or finished. Matches are public: any signed-in player may look. */
	app.get("/matches/:id/rounds", playerAuth(sql), validate("param", MatchParam), async (c) => {
		const { id } = c.req.valid("param");
		const found = await matchRounds(sql, id);
		if (!found) {
			throw new ApiError("not_found", 404, "No such match.");
		}

		return ok(c, found);
	});

	/** The signed-in player's own history, newest first. */
	app.get("/players/me/matches", playerAuth(sql), validate("query", HistoryQuery), async (c) => {
		const { cursor } = c.req.valid("query");
		const page = await history(sql, c.get("player").id, cursor);

		return ok(c, page);
	});

	/** The signed-in player's record per game, for their profile. */
	app.get("/players/me/stats", playerAuth(sql), async (c) => {
		const record = await stats(sql, c.get("player").id);

		return ok(c, record);
	});

	return app;
}
