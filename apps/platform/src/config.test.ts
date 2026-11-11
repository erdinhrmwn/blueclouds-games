import { describe, expect, test } from "bun:test";
import { loadConfig, loadDbConfig } from "./config";

const env = {
	PLATFORM_DB_HOST: "127.0.0.1",
	PLATFORM_DB_USER: "platform",
	PLATFORM_DB_NAME: "platform",
	PLAY_TOKEN_PRIVATE_KEY: "{}",
	PLATFORM_SERVER_KEY: "x".repeat(32),
	PLATFORM_ALLOWED_ORIGINS: "http://localhost:5173, https://nblueclouds.online",
};

describe("config", () => {
	test("builds the database options from PLATFORM_DB_* with defaults", () => {
		const c = loadConfig(env);
		expect(c.db).toEqual({ hostname: "127.0.0.1", port: 5432, username: "platform", password: "", database: "platform" });
		expect(c.allowedOrigins).toEqual(["http://localhost:5173", "https://nblueclouds.online"]);
		expect(c.host).toBe("127.0.0.1");
		expect(c.port).toBe(3000);
	});

	test("names every missing or bad key", () => {
		expect(() => loadDbConfig({ PLATFORM_DB_PORT: "abc" })).toThrow(/PLATFORM_DB_HOST.*PLATFORM_DB_PORT.*PLATFORM_DB_USER.*PLATFORM_DB_NAME/);
		expect(() => loadConfig({ ...env, PLATFORM_SERVER_KEY: "short" })).toThrow(/PLATFORM_SERVER_KEY/);
	});
});
