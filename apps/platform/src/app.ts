import type { SQL } from "bun";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
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

export function createApp(deps: Deps) {
	const app = new Hono<AppEnv>();

	app.use(requestId());
	app.use(secureHeaders());
	app.use(
		cors({
			origin: deps.config.allowedOrigins,
			allowMethods: ["GET", "POST", "PATCH"],
			allowHeaders: ["Authorization", "Content-Type"],
			exposeHeaders: ["X-Request-Id"],
			maxAge: 600,
		}),
	);
	app.use(
		bodyLimit({
			maxSize: MAX_BODY_BYTES,
			onError: (c) => fail(c, new ApiError("payload_too_large", 413, "Request body is too large.")),
		}),
	);

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
