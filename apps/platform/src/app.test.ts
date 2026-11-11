import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, setupTestApp } from "./test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
	t = await setupTestApp();
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
		expect(res.json).toEqual({ ok: false, data: null, error: { code: "not_found", message: "Not found." } });
	});

	test("oversized body is rejected with the envelope", async () => {
		const res = await call(t.app, "POST", "/v1/players/guest", { body: JSON.stringify({ name: "x".repeat(20_000) }) });
		expect(res.status).toBe(413);
		expect(res.json.error.code).toBe("payload_too_large");
	});

	test("sends no CORS headers: browsers never call the platform", async () => {
		const res = await call(t.app, "GET", "/v1/health", { headers: { origin: "http://evil.test" } });
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});
