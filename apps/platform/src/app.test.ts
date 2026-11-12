import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { call, setupTestApp } from "./test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
	t = await setupTestApp();

	// Stands in for a Hono middleware that throws, e.g. a timeout or a validator.
	t.app.get("/v1/test/http-exception", () => {
		throw new HTTPException(401, { message: "No entry." });
	});
});
afterAll(async () => {
	await t.sql.close();
});

describe("envelope", () => {
	test("health returns ok envelope with a request id", async () => {
		const res = await call(t.app, "GET", "/v1/health");
		expect(res.status).toBe(200);
		expect(res.json).toEqual({ ok: true, data: { status: "ok" }, error: null });
		expect(res.headers.get("x-request-id")).toBeTruthy();
	});

	test("unknown route is a not_found envelope", async () => {
		const res = await call(t.app, "GET", "/v1/nope");
		expect(res.status).toBe(404);
		expect(res.json).toEqual({
			ok: false,
			data: null,
			error: { code: "not_found", message: "Not found." },
		});
	});

	test("oversized body is rejected with the envelope", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", {
			body: JSON.stringify({ name: "x".repeat(20_000) }),
		});
		expect(res.status).toBe(413);
		expect(res.json.error.code).toBe("payload_too_large");
	});

	test("an HTTPException from Hono keeps its status inside the envelope", async () => {
		const res = await call(t.app, "GET", "/v1/test/http-exception");
		expect(res.status).toBe(401);
		expect(res.json).toEqual({
			ok: false,
			data: null,
			error: { code: "unauthenticated", message: "No entry." },
		});
	});

	test("malformed JSON is a bad_input envelope", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", {
			body: "{not json",
			headers: { "x-forwarded-for": crypto.randomUUID() },
		});
		expect(res.status).toBe(400);
		expect(res.json.error.code).toBe("bad_input");
	});

	test("sends no CORS headers: browsers never call the platform", async () => {
		const res = await call(t.app, "GET", "/v1/health", { headers: { origin: "http://evil.test" } });
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});
