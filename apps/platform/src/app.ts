import type { SQL } from "bun";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { except } from "hono/combine";
import { HTTPException } from "hono/http-exception";
import { requestId, type RequestIdVariables } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Config } from "./config";
import { ApiError, type ErrorCode, fail, ok } from "./lib/http";
import { log } from "./lib/log";
import { matchRoutes } from "./routes/matches";
import { playerRoutes } from "./routes/players";
import { roomRoutes } from "./routes/rooms";
import type { Signer } from "./lib/play-tokens";
import { tournamentRoutes } from "./routes/tournaments";

export type Deps = { sql: SQL; config: Config; signer: Signer };
export type AppEnv = { Variables: RequestIdVariables };

const MAX_BODY_BYTES = 16 * 1024;
/** Match reports carry the whole move log (a 6-player Bust 31 match is about 25 KB). */
const MAX_MATCH_BODY_BYTES = 512 * 1024;
const MATCH_REPORT_PATH = "/v1/matches";

/** Error codes for the HTTPExceptions Hono's own middleware may throw; other 4xx are bad input. */
const HTTP_EXCEPTION_CODES: Partial<Record<number, ErrorCode>> = {
	401: "unauthenticated",
	403: "forbidden",
	404: "not_found",
	413: "payload_too_large",
	429: "rate_limited",
};

export function createApp(deps: Deps) {
	const app = new Hono<AppEnv>();

	app.use(requestId());
	app.use(secureHeaders());

	const limitBody = (maxSize: number) =>
		bodyLimit({
			maxSize,
			onError: (c) => fail(c, new ApiError("payload_too_large", 413, "Request body is too large.")),
		});

	app.use(except(MATCH_REPORT_PATH, limitBody(MAX_BODY_BYTES)));
	app.use(MATCH_REPORT_PATH, limitBody(MAX_MATCH_BODY_BYTES));

	/** For the container healthcheck: the process is up and the database answers. */
	app.get("/v1/health", async (c) => {
		await deps.sql`SELECT 1`;

		return ok(c, { status: "ok" });
	});

	app.route("/v1", playerRoutes(deps.sql, deps.signer));
	app.route("/v1", matchRoutes(deps.sql, deps.config.serverKey));
	app.route("/v1", roomRoutes(deps.sql, deps.config.serverKey));
	app.route("/v1", tournamentRoutes(deps.sql));

	app.notFound((c) => fail(c, new ApiError("not_found", 404, "Not found.")));

	app.onError((err, c) => {
		if (err instanceof ApiError) return fail(c, err);

		if (err instanceof HTTPException && err.status < 500) {
			const code = HTTP_EXCEPTION_CODES[err.status] ?? "bad_input";
			const message = err.message || "The request was rejected.";

			return fail(c, new ApiError(code, err.status, message));
		}

		log.error({
			msg: "unhandled error",
			requestId: c.get("requestId"),
			path: c.req.path,
			err: String(err),
			stack: err.stack,
		});

		return fail(c, new ApiError("internal", 500, "Something went wrong. Try again later."));
	});

	return app;
}
