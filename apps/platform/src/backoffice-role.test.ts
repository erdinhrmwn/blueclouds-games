import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { guest, setupTestApp } from "./test-helpers";

// The backoffice talks to Postgres directly, so the role's grants are its only guard rails.
let t: Awaited<ReturnType<typeof setupTestApp>>;
let playerId: string;
beforeAll(async () => {
	t = await setupTestApp();
	playerId = (await guest(t.app)).player.id;
});
afterAll(() => t.sql.close());

/** Runs `fn` as the backoffice role, then rolls back. Resolves to the error message, or "ok". */
const asBackoffice = (query: string, ...params: unknown[]) =>
	t.sql
		.begin(async (tx) => {
			await tx`SET LOCAL ROLE backoffice`;
			await tx.unsafe(query, params);
			throw new Error("ok");
		})
		.catch((e: Error) => e.message);

describe("backoffice role", () => {
	test("can read players and matches, and disable a player", async () => {
		expect(await asBackoffice("SELECT id, display_name FROM players")).toBe("ok");
		expect(await asBackoffice("SELECT * FROM match_players")).toBe("ok");
		expect(await asBackoffice("UPDATE players SET disabled_at = now(), disabled_reason = 'x' WHERE id = $1", playerId)).toBe("ok");
		expect(await asBackoffice("UPDATE player_secrets SET revoked_at = now() WHERE player_id = $1", playerId)).toBe("ok");
		expect(await asBackoffice("INSERT INTO admin_audit (action) VALUES ('test')")).toBe("ok");
	});

	test("cannot rename players, read secret hashes or write matches", async () => {
		expect(await asBackoffice("UPDATE players SET display_name = 'x' WHERE id = $1", playerId)).toContain("permission denied");
		expect(await asBackoffice("SELECT secret_hash FROM player_secrets")).toContain("permission denied");
		expect(await asBackoffice("DELETE FROM matches")).toContain("permission denied");
		expect(await asBackoffice("INSERT INTO players (display_name) VALUES ('x')")).toContain("permission denied");
	});
});
