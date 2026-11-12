import type { SQL } from "bun";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { z } from "zod";
import { ok, validate } from "../lib/http";
import { playerAuth } from "../middleware/auth";
import { listOpen, seatedRooms, setRegistration } from "../services/tournaments";

const GameQuery = z.object({ game: z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.") });
const OptionalGame = z.object({ game: GameQuery.shape.game.optional() });
const TournamentParam = z.object({ id: z.uuid("Not a tournament id.") });

export function tournamentRoutes(sql: SQL) {
	const app = new Hono<AppEnv>();
	const auth = playerAuth(sql);
	const tournamentParam = validate("param", TournamentParam);

	app.get("/tournaments", auth, validate("query", GameQuery), async (c) => {
		const { game } = c.req.valid("query");
		const tournaments = await listOpen(sql, game, c.get("player").id);

		return ok(c, { tournaments });
	});

	app.post("/tournaments/:id/registration", auth, tournamentParam, async (c) => {
		const { id: tournamentId } = c.req.valid("param");
		await setRegistration(sql, tournamentId, c.get("player").id, true);

		return ok(c, { registered: true });
	});

	app.delete("/tournaments/:id/registration", auth, tournamentParam, async (c) => {
		const { id: tournamentId } = c.req.valid("param");
		await setRegistration(sql, tournamentId, c.get("player").id, false);

		return ok(c, { registered: false });
	});

	app.get("/players/me/rooms", auth, validate("query", OptionalGame), async (c) => {
		const { game } = c.req.valid("query");
		const rooms = await seatedRooms(sql, c.get("player").id, game);

		return ok(c, { rooms });
	});

	return app;
}
