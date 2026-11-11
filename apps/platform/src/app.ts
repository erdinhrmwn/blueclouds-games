import type { SQL } from "bun";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId, type RequestIdVariables } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Config } from "./config";
import { ApiError, fail, ok } from "./http";
import { log } from "./log";
import { matchRoutes } from "./matches";
import { playerRoutes } from "./players";
import type { Signer } from "./tokens";

export type Deps = { sql: SQL; config: Config; signer: Signer };
export type AppEnv = { Variables: RequestIdVariables };

const MAX_BODY_BYTES = 16 * 1024;
/** Match reports carry the whole move log (a 6-player Bust 31 match is about 25 KB). */
const MAX_MATCH_BODY_BYTES = 512 * 1024;

export function createApp(deps: Deps) {
	const app = new Hono<AppEnv>();

	app.use(requestId());
	app.use(secureHeaders());
	const limit = (maxSize: number) =>
		bodyLimit({ maxSize, onError: (c) => fail(c, new ApiError("payload_too_large", 413, "Request body is too large.")) });
	const [small, large] = [limit(MAX_BODY_BYTES), limit(MAX_MATCH_BODY_BYTES)];
	app.use((c, next) => (c.req.path === "/v1/matches" ? large : small)(c, next));

	/** For the container healthcheck: the process is up and the database answers. */
	app.get("/v1/health", async (c) => {
		await deps.sql`SELECT 1`;
		return ok(c, { status: "ok" });
	});

	app.route("/v1", playerRoutes(deps.sql, deps.signer));
	app.route("/v1", matchRoutes(deps.sql, deps.config.serverKey));

	app.notFound((c) => fail(c, new ApiError("not_found", 404, "Not found.")));
	app.onError((err, c) => {
		if (err instanceof ApiError) return fail(c, err);
		log.error({ msg: "unhandled error", requestId: c.get("requestId"), path: c.req.path, err: String(err), stack: err.stack });
		return fail(c, new ApiError("internal", 500, "Something went wrong. Try again later."));
	});

	return app;
}
