import type { SQL } from "bun";
import { ApiError } from "../lib/http";

/**
 * The coin wallet (docs/plans/coin-wallet.md): virtual coins for tournament fees and prizes. Every change goes
 * through `moveCoins`, which writes the ledger row and the balance together inside the caller's transaction.
 */

/** Coins a new account starts with (Erdin, 2026-11-13). */
export const SIGNUP_BONUS = 1_000;

/** History rows per page. */
const HISTORY_PAGE = 50;

export type CoinReason =
	| "signup_bonus"
	| "admin_grant"
	| "admin_take"
	| "tournament_fee"
	| "tournament_refund"
	| "tournament_prize";

/** Not enough coins for a spend; carries both numbers so the message can say how many are missing. */
export class NotEnoughCoins extends ApiError {
	constructor(
		readonly balance: number,
		readonly needed: number,
	) {
		super(
			"conflict",
			409,
			`Not enough coins: you have ${balance.toLocaleString("en")}, this needs ${needed.toLocaleString("en")}.`,
		);
	}
}

/**
 * Adds (amount > 0) or takes (amount < 0) coins, inside the caller's transaction. Locks the wallet, refuses to go
 * below zero, writes the ledger row with the balance after, and returns that balance.
 */
export async function moveCoins(
	tx: SQL,
	move: {
		playerId: string;
		amount: number;
		reason: CoinReason;
		tournamentId?: string | null;
		adminId?: string | null;
		note?: string | null;
	},
): Promise<number> {
	if (!Number.isSafeInteger(move.amount) || move.amount === 0) {
		throw new Error(`moveCoins: amount must be a non-zero whole number, got ${move.amount}`);
	}

	await tx`
		INSERT INTO wallets (player_id)
		VALUES (${move.playerId})
		ON CONFLICT (player_id) DO NOTHING`;

	const [wallet] = await tx`
		SELECT balance
		FROM wallets
		WHERE player_id = ${move.playerId}
		FOR UPDATE`;

	const balance = Number(wallet.balance);
	const after = balance + move.amount;
	if (after < 0) {
		throw new NotEnoughCoins(balance, -move.amount);
	}

	await tx`
		UPDATE wallets
		SET balance = ${after}
		WHERE player_id = ${move.playerId}`;

	await tx`
		INSERT INTO coin_ledger (player_id, amount, balance_after, reason, tournament_id, admin_id, note)
		VALUES (
			${move.playerId},
			${move.amount},
			${after},
			${move.reason},
			${move.tournamentId ?? null},
			${move.adminId ?? null},
			${move.note ?? null}
		)`;

	return after;
}

/** A player's balance; 0 before they ever had coins. */
export async function balanceOf(sql: SQL, playerId: string): Promise<number> {
	const [wallet] = await sql`SELECT balance FROM wallets WHERE player_id = ${playerId}`;
	return wallet ? Number(wallet.balance) : 0;
}

/** Gives a new account its bonus, once ever (the ledger's unique index makes a second try a no-op). */
export async function grantSignupBonus(tx: SQL, playerId: string): Promise<void> {
	const [already] = await tx`
		SELECT 1 FROM coin_ledger
		WHERE player_id = ${playerId} AND reason = 'signup_bonus'`;
	if (already) {
		return;
	}

	await moveCoins(tx, { playerId, amount: SIGNUP_BONUS, reason: "signup_bonus" });
}

/** A player's coin history, newest first; `before` is the last id of the previous page. */
export async function coinHistory(sql: SQL, playerId: string, before?: string) {
	const page = before ? sql`AND cl.id < ${before}` : sql``;
	const rows = await sql`
		SELECT
			cl.id,
			cl.amount,
			cl.balance_after,
			cl.reason,
			cl.note,
			cl.created_at,
			t.id AS tournament_id,
			t.name AS tournament_name,
			t.cancelled_at IS NOT NULL AS tournament_cancelled
		FROM coin_ledger cl
		LEFT JOIN tournaments t ON t.id = cl.tournament_id
		WHERE cl.player_id = ${playerId}
			${page}
		ORDER BY cl.id DESC
		LIMIT ${HISTORY_PAGE}`;

	return rows.map((row: any) => ({
		id: row.id,
		amount: Number(row.amount),
		balanceAfter: Number(row.balance_after),
		reason: row.reason as CoinReason,
		note: row.note,
		at: row.created_at.toISOString(),
		tournament: row.tournament_id
			? { id: row.tournament_id, name: row.tournament_name, cancelled: row.tournament_cancelled }
			: null,
	}));
}

/** Gives back what a sign-up paid, if anything, and marks it given back. Call it before the sign-up is deleted. */
export async function refundSignUp(
	tx: SQL,
	tournamentId: string,
	playerId: string,
): Promise<number> {
	const [signUp] = await tx`
		SELECT fee_paid
		FROM tournament_players
		WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}
		FOR UPDATE`;

	const paid = signUp ? Number(signUp.fee_paid) : 0;
	if (paid === 0) {
		return 0;
	}

	await tx`
		UPDATE tournament_players
		SET fee_paid = 0
		WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}`;
	await moveCoins(tx, { playerId, amount: paid, reason: "tournament_refund", tournamentId });

	return paid;
}

/** A cancelled tournament gives every fee back. Returns how many players were refunded. */
export async function refundEveryone(tx: SQL, tournamentId: string): Promise<number> {
	const owed = await tx`
		SELECT player_id
		FROM tournament_players
		WHERE tournament_id = ${tournamentId} AND fee_paid > 0`;

	for (const { player_id: playerId } of owed) {
		await refundSignUp(tx, tournamentId, playerId);
	}

	return owed.length;
}
