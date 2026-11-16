import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { call, setupTestApp } from "./test-helpers";

let testApp: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
	testApp = await setupTestApp();

	// Stands in for a Hono middleware that throws, e.g. a timeout or a validator.
	testApp.app.get("/v1/test/http-exception", () => {
		throw new HTTPException(401, { message: "No entry." });
	});
});
afterAll(async () => {
	await testApp.sql.close();
});

describe("envelope", () => {
	test("health returns ok envelope with a request id and no CORS headers", async () => {
		const res = await call(testApp.app, "GET", "/v1/health", {
			headers: { origin: "http://evil.test" },
		});
		expect(res.status).toBe(200);
		expect(res.json).toEqual({ ok: true, data: { status: "ok" }, error: null });
		expect(res.headers.get("x-request-id")).toBeTruthy();
		// Browsers never call the platform.
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("errors keep the envelope: unknown route, oversized body, HTTPException, malformed JSON", async () => {
		const cases = [
			{ method: "GET", path: "/v1/nope", body: undefined, status: 404, code: "not_found" },
			{
				method: "POST",
				path: "/v1/players/guest",
				body: JSON.stringify({ name: "x".repeat(20_000) }),
				status: 413,
				code: "payload_too_large",
			},
			{
				method: "GET",
				path: "/v1/test/http-exception",
				body: undefined,
				status: 401,
				code: "unauthenticated",
			},
			{
				method: "POST",
				path: "/v1/players/guest",
				body: "{not json",
				status: 400,
				code: "bad_input",
			},
		];

		for (const { method, path, body, status, code } of cases) {
			const res = await call(testApp.app, method, path, {
				body,
				headers: { "x-forwarded-for": crypto.randomUUID() },
			});
			expect([path, res.status, res.json.ok, res.json.data, res.json.error.code]).toEqual([
				path,
				status,
				false,
				null,
				code,
			]);
		}

		const hono = await call(testApp.app, "GET", "/v1/test/http-exception");
		expect(hono.json.error.message).toBe("No entry.");
	});
});
