import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { ok, parse } from "../lib/http";
import { playerAuth, type PlayerVariables } from "../middleware/auth";
import { listOpen, seatedRooms, setRegistration } from "../services/tournaments";

const GameQuery = z.object({ game: z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.") });
const OptionalGame = z.object({ game: GameQuery.shape.game.optional() });
const Id = z.uuid("Not a tournament id.");

export function tournamentRoutes(sql: SQL) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);

	app.get("/tournaments", auth, async (c) => {
		const { game } = parse(GameQuery, c.req.query());
		return ok(c, { tournaments: await listOpen(sql, game, c.get("player").id) });
	});

	/** POST signs the player up, DELETE signs them out. */
	const register = (join: boolean) =>
		app[join ? "post" : "delete"]("/tournaments/:id/registration", auth, async (c) => {
			await setRegistration(sql, parse(Id, c.req.param("id")), c.get("player").id, join);
			return ok(c, { registered: join });
		});
	register(true);
	register(false);

	app.get("/players/me/rooms", auth, async (c) => {
		const { game } = parse(OptionalGame, c.req.query());
		return ok(c, { rooms: await seatedRooms(sql, c.get("player").id, game) });
	});

	return app;
}
