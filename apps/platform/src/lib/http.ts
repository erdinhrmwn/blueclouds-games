import { zValidator } from "@hono/zod-validator";
import type { Context, ValidationTargets } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export type ErrorCode =
	| "bad_input"
	| "unauthenticated"
	| "forbidden"
	| "not_found"
	| "conflict"
	| "payload_too_large"
	| "unknown_player"
	| "unknown_room"
	| "under_maintenance"
	| "rate_limited"
	| "internal";

/** An error whose message is safe to show to the caller. Anything else becomes `internal`. */
export class ApiError extends Error {
	constructor(
		readonly code: ErrorCode,
		readonly status: ContentfulStatusCode,
		message: string,
		readonly fields?: Record<string, string>,
	) {
		super(message);
	}
}

/** Success envelope. `data` is always an object so fields can be added later. */
export const ok = <T extends object>(c: Context, data: T, status: ContentfulStatusCode = 200) =>
	c.json({ ok: true, data, error: null }, status);

/** Error envelope. */
export function fail(c: Context, err: ApiError) {
	const error = {
		code: err.code,
		message: err.message,
		...(err.fields && { fields: err.fields }),
	};

	return c.json({ ok: false, data: null, error }, err.status);
}

/**
 * Validator middleware: the handler reads the result with `c.req.valid(target)`.
 * A failure throws `bad_input` with one message per field; malformed JSON is a 400 from Hono.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
	target: Target,
	schema: Schema,
) =>
	zValidator(target, schema, (result) => {
		if (result.success) {
			return;
		}

		const fields: Record<string, string> = {};
		for (const issue of result.error.issues) {
			const key = issue.path.join(".") || "_";
			fields[key] ??= issue.message;
		}

		throw new ApiError("bad_input", 400, "Some fields are invalid.", fields);
	});
