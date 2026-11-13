import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { moveCoins, SIGNUP_BONUS } from "../services/coins";
import { runTournamentJob } from "../services/tournaments";
import { call, guest, setupTestApp } from "../test-helpers";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let admin: string;
beforeAll(async () => {
	t = await setupTestApp();
	[{ id: admin }] =
		await t.sql`INSERT INTO admins (username, password_hash, role) VALUES ('root', '$argon2id$v=19$test', 'owner') RETURNING id`;
});
afterAll(() => t.sql.close());

const ip = () => ({ "x-forwarded-for": crypto.randomUUID() });
let accountNumber = 0;

/** A fresh account (with its sign-up bonus) and its secret. */
async function account() {
	accountNumber += 1;
	const body = {
		name: `Acc ${accountNumber}`,
		username: `acc_${accountNumber}`,
		password: "long enough",
	};
	const res = await call(t.app, "POST", "/v1/players/register", { body, headers: ip() });
	return { id: res.json.data.player.id as string, secret: res.json.data.playerSecret as string };
}

const coinsOf = async (secret: string) =>
	(await call(t.app, "GET", "/v1/players/me", { token: secret })).json.data.coins as number;

/** The balance always equals the sum of the player's ledger. */
async function ledgerMatches(playerId: string) {
	const [{ sum }] =
		await t.sql`SELECT coalesce(sum(amount), 0)::bigint AS sum FROM coin_ledger WHERE player_id = ${playerId}`;
	const [wallet] = await t.sql`SELECT balance FROM wallets WHERE player_id = ${playerId}`;
	expect(Number(sum)).toBe(Number(wallet?.balance ?? 0));
}

async function tournament(fee: number, opts: { closes?: number; min?: number } = {}) {
	const at = (min: number) => new Date(Date.now() + min * 60_000);
	const [row] = await t.sql`
		INSERT INTO tournaments (game_slug, name, players_per_room, min_players, fee, starts_at, registration_opens_at, registration_closes_at, created_by_admin_id)
		VALUES ('bust-31', 'Fee Cup', 2, ${opts.min ?? null}, ${fee}, ${at(30)}, ${at(-60)}, ${at(opts.closes ?? 20)}, ${admin})
		RETURNING id`;
	return row.id as string;
}

const join = (id: string, secret: string) =>
	call(t.app, "POST", `/v1/tournaments/${id}/registration`, { token: secret });
const leave = (id: string, secret: string) =>
	call(t.app, "DELETE", `/v1/tournaments/${id}/registration`, { token: secret });

describe("the wallet", () => {
	test("a new account gets its bonus once; a guest gets none until it becomes an account", async () => {
		const acc = await account();
		expect(await coinsOf(acc.secret)).toBe(SIGNUP_BONUS);

		const g = await guest(t.app, "Gus");
		expect(await coinsOf(g.secret)).toBe(0);
		const body = { name: "Gus", username: "gus_99", password: "long enough" };
		await call(t.app, "POST", "/v1/players/register", { body, token: g.secret, headers: ip() });
		expect(await coinsOf(g.secret)).toBe(SIGNUP_BONUS);

		// A retry can't pay the bonus twice.
		await t.sql.begin(async (tx) => {
			const { grantSignupBonus } = await import("../services/coins");
			await grantSignupBonus(tx, g.player.id);
		});
		expect(await coinsOf(g.secret)).toBe(SIGNUP_BONUS);
		await ledgerMatches(g.player.id);
	});

	test("a balance never goes below zero, and the ledger is history", async () => {
		const acc = await account();
		await expect(
			t.sql.begin((tx) =>
				moveCoins(tx, {
					playerId: acc.id,
					amount: -SIGNUP_BONUS - 1,
					reason: "tournament_fee",
					tournamentId: null,
				}),
			),
		).rejects.toThrow("Not enough coins");
		await expect(
			t.sql`UPDATE coin_ledger SET amount = 5 WHERE player_id = ${acc.id}`,
		).rejects.toThrow();
		await ledgerMatches(acc.id);
	});

	test("history lists every change, newest first", async () => {
		const acc = await account();
		const cup = await tournament(100);
		await join(cup, acc.secret);
		await leave(cup, acc.secret);

		const res = await call(t.app, "GET", "/v1/players/me/coins", { token: acc.secret });
		expect(res.json.data.balance).toBe(SIGNUP_BONUS);
		expect(
			res.json.data.history.map((row: { reason: string; amount: number }) => [
				row.reason,
				row.amount,
			]),
		).toEqual([
			["tournament_refund", 100],
			["tournament_fee", -100],
			["signup_bonus", SIGNUP_BONUS],
		]);
		expect(res.json.data.history[0].tournament).toMatchObject({ id: cup, name: "Fee Cup" });
	});
});

describe("tournament fees", () => {
	test("joining takes the fee; too few coins is refused and signs nobody up", async () => {
		const acc = await account();
		const cheap = await tournament(300);
		const dear = await tournament(SIGNUP_BONUS);

		expect((await join(cheap, acc.secret)).status).toBe(200);
		expect(await coinsOf(acc.secret)).toBe(SIGNUP_BONUS - 300);

		// Joining twice doesn't charge twice.
		expect((await join(cheap, acc.secret)).status).toBe(200);
		expect(await coinsOf(acc.secret)).toBe(SIGNUP_BONUS - 300);

		const refused = await join(dear, acc.secret);
		expect(refused.status).toBe(409);
		expect(refused.json.error.message).toBe("Not enough coins: you have 700, this needs 1,000.");
		const [{ n }] =
			await t.sql`SELECT count(*)::int AS n FROM tournament_players WHERE tournament_id = ${dear}`;
		expect(n).toBe(0);
		await ledgerMatches(acc.id);
	});

	test("leaving during sign-up and withdrawing before the table starts give the fee back", async () => {
		const ann = await account();
		const bob = await account();
		const cup = await tournament(200, { closes: 20 });

		await join(cup, ann.secret);
		await leave(cup, ann.secret);
		expect(await coinsOf(ann.secret)).toBe(SIGNUP_BONUS);

		await join(cup, ann.secret);
		await join(cup, bob.secret);
		await t.sql`UPDATE tournaments SET registration_closes_at = now() - interval '1 minute' WHERE id = ${cup}`;
		await runTournamentJob(t.sql);

		expect((await leave(cup, bob.secret)).status).toBe(200);
		expect(await coinsOf(bob.secret)).toBe(SIGNUP_BONUS);
		expect(await coinsOf(ann.secret)).toBe(SIGNUP_BONUS - 200);
		await ledgerMatches(bob.id);
	});

	test("a tournament cancelled for too few players gives everyone their fee back", async () => {
		const ann = await account();
		const cup = await tournament(150, { min: 4 });
		await join(cup, ann.secret);
		expect(await coinsOf(ann.secret)).toBe(SIGNUP_BONUS - 150);

		await t.sql`UPDATE tournaments SET registration_closes_at = now() - interval '1 minute' WHERE id = ${cup}`;
		expect((await runTournamentJob(t.sql)).cancelled).toBeGreaterThanOrEqual(1);
		expect(await coinsOf(ann.secret)).toBe(SIGNUP_BONUS);

		const [signUp] =
			await t.sql`SELECT fee_paid FROM tournament_players WHERE tournament_id = ${cup} AND player_id = ${ann.id}`;
		expect(Number(signUp.fee_paid)).toBe(0);
		await ledgerMatches(ann.id);
	});
});
