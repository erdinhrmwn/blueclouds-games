import { describe, expect, test } from "bun:test";
import { loadConfig, loadDbConfig } from "./config";

const env = {
	DB_HOST: "127.0.0.1",
	DB_USER: "platform",
	DB_NAME: "platform",
	PLAY_TOKEN_PRIVATE_KEY: "{}",
	PLATFORM_SERVER_KEY: "x".repeat(32),
	ALLOWED_ORIGINS: "http://localhost:5173, https://nblueclouds.online",
};

describe("config", () => {
	test("builds the database options from DB_* with defaults", () => {
		const c = loadConfig(env);
		expect(c.db).toEqual({ hostname: "127.0.0.1", port: 5432, username: "platform", password: "", database: "platform" });
		expect(c.allowedOrigins).toEqual(["http://localhost:5173", "https://nblueclouds.online"]);
		expect(c.port).toBe(3000);
	});

	test("names every missing or bad key", () => {
		expect(() => loadDbConfig({ DB_PORT: "abc" })).toThrow(/DB_HOST.*DB_PORT.*DB_USER.*DB_NAME/);
		expect(() => loadConfig({ ...env, PLATFORM_SERVER_KEY: "short" })).toThrow(/PLATFORM_SERVER_KEY/);
	});
});
