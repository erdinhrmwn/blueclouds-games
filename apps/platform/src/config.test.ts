import { describe, expect, test } from "bun:test";
import { loadConfig, loadDbConfig } from "./config";

const env = {
	DATABASE_HOST: "127.0.0.1",
	DATABASE_USER: "platform",
	DATABASE_NAME: "platform",
	PLAY_TOKEN_PRIVATE_KEY: "A".repeat(43),
	PLATFORM_SERVER_KEY: "x".repeat(32),
};

describe("config", () => {
	test("builds the database options from DATABASE_* with defaults", () => {
		const c = loadConfig(env);
		expect(c.db).toEqual({ hostname: "127.0.0.1", port: 5432, username: "platform", password: "", database: "platform" });
		expect(c.host).toBe("127.0.0.1");
		expect(c.port).toBe(3000);
	});

	test("names every missing or bad key", () => {
		expect(() => loadDbConfig({ DATABASE_PORT: "abc" })).toThrow(/DATABASE_HOST.*DATABASE_PORT.*DATABASE_USER.*DATABASE_NAME/);
		expect(() => loadConfig({ ...env, PLATFORM_SERVER_KEY: "short" })).toThrow(/PLATFORM_SERVER_KEY/);
		expect(() => loadConfig({ ...env, PLAY_TOKEN_PRIVATE_KEY: '{"kty":"OKP"}' })).toThrow(/PLAY_TOKEN_PRIVATE_KEY: must be a 43-character base64url/);
	});
});
