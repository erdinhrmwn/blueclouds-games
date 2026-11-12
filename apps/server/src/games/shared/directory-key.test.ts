import { describe, expect, test } from "bun:test";
import { directoryKey } from "./room";

describe("room list key", () => {
	test("public tables use the game's list, tournament tables their own, private tables none", () => {
		expect(directoryKey("bust-31", true, false)).toBe("bust-31");
		expect(directoryKey("bust-31", false, true)).toBe("bust-31:tournament");
		expect(directoryKey("bust-31", false, false)).toBeNull();
	});
});
