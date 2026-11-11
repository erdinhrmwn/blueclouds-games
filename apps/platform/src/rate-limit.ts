import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { ApiError } from "./http";

/** Above this many tracked keys, expired windows are swept so the map cannot grow forever. */
const SWEEP_AT = 10_000;

/**
 * Fixed-window limit per client IP.
 * ponytail: state lives in this process, which is right for one platform instance.
 * With more instances, move the counters to DragonflyDB.
 */
export function rateLimit(limit: number, windowMs: number): MiddlewareHandler {
	const windows = new Map<string, { count: number; resetAt: number }>();
	return async (c, next) => {
		const now = Date.now();
		if (windows.size > SWEEP_AT) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
		const key = clientIp(c);
		const w = windows.get(key);
		if (!w || w.resetAt <= now) windows.set(key, { count: 1, resetAt: now + windowMs });
		else if (++w.count > limit) {
			c.header("Retry-After", String(Math.ceil((w.resetAt - now) / 1000)));
			throw new ApiError("rate_limited", 429, "Too many requests. Try again shortly.");
		}
		await next();
	};
}

/**
 * Only the game's server and the actors can reach the platform (internal network, port never
 * published), and the game's server puts the player's IP in X-Forwarded-For, so the header can
 * be trusted. Without it use the socket address.
 */
function clientIp(c: Context): string {
	const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
	if (forwarded) return forwarded;
	try {
		return getConnInfo(c).remote.address ?? "unknown";
	} catch {
		return "unknown"; // no socket in tests (app.request)
	}
}
