import type { Context } from "hono";
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
export const fail = (c: Context, err: ApiError) =>
	c.json(
		{
			ok: false,
			data: null,
			error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) },
		},
		err.status,
	);

/** Validates input; on failure throws `bad_input` with one message per field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
	const result = schema.safeParse(input);
	if (result.success) return result.data;
	const fields: Record<string, string> = {};
	for (const issue of result.error.issues) {
		const key = issue.path.join(".") || "_";
		fields[key] ??= issue.message;
	}
	throw new ApiError("bad_input", 400, "Some fields are invalid.", fields);
}

/** Reads a JSON body; a missing or malformed body is the caller's mistake, not ours. */
export async function readJson(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new ApiError("bad_input", 400, "Body must be valid JSON.");
	}
}
