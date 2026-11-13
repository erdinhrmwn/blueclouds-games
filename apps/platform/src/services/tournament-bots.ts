import type { SQL, TransactionSQL } from "bun";
import { log } from "../lib/log";
import { balanceOf, moveCoins } from "./coins";

/**
 * Bots that fill a tournament's tables (Erdin, 2026-11-13). In sign-up's last minute, when its people already
 * reach the minimum and 80% of the size aimed for (botTarget), bot accounts sign up: a knockout up to a perfect
 * bracket, Arena and Swiss up to full tables, never past the maximum. They pay the fee like anyone (topped up
 * first when short) and can win prizes. Their seats are played by the room.
 */

/** How long before sign-up closes the bots come in. */
export const BOTS_BEFORE_CLOSE = "1 minute";

/** Names for new bot accounts, used in turn; a number is added once they run out. */
const BOT_NAMES = [
	"Ash",
	"Bree",
	"Cove",
	"Dune",
	"Ember",
	"Fern",
	"Gale",
	"Haze",
	"Iris",
	"Jade",
	"Kite",
	"Lark",
	"Mist",
	"Nova",
	"Opal",
	"Pike",
	"Quill",
	"Reed",
	"Sage",
	"Tide",
	"Umber",
	"Vale",
	"Wren",
	"Yarrow",
];

/** Bots only top up a tournament whose people already fill this share of it (Erdin, 2026-11-14). */
export const BOTS_FROM_SHARE = 0.8;

export type BotInput = {
	/** Everyone signed up so far, bots included. */
	registered: number;
	/** Those who aren't bots. */
	people: number;
	perTable: number;
	minPlayers: number | null;
	maxPlayers: number | null;
	format: "arena" | "knockout" | "swiss" | null;
};

/**
 * The smallest "perfect bracket" holding these players: tables of `perTable`, raised to a power (4 a table: 4, 16,
 * 64; 2 a table: 2, 4, 8, 16), so in a knockout every round's tables are full down to the final.
 */
export function perfectBracket(players: number, perTable: number): number {
	if (perTable < 2) {
		return players;
	}

	let size = perTable;
	while (size < players) {
		size *= perTable;
	}

	return size;
}

/**
 * How many players bots fill a tournament to, or null when they don't come in (Erdin, 2026-11-14):
 * - only once its people reach the minimum and 80% of the size aimed for, so bots top up a nearly full tournament
 *   and never rescue one too few people wanted;
 * - a knockout aims for a perfect bracket (or, past the maximum, full tables); Arena and Swiss for full tables,
 *   their size being the maximum when there is one;
 * - never past the maximum, never more tables than people, never fewer than already signed up.
 */
export function botTarget(input: BotInput): number | null {
	const { registered, people, perTable, minPlayers, maxPlayers, format } = input;

	if (people === 0) {
		return null;
	}

	if (minPlayers !== null && people < minPlayers) {
		return null;
	}

	const fullTables = Math.ceil(registered / perTable) * perTable;
	const isKnockout = format === null || format === "knockout";

	let size: number;
	let target: number;

	if (isKnockout) {
		const perfect = perfectBracket(people, perTable);
		const fits = maxPlayers === null || perfect <= maxPlayers;
		size = fits ? perfect : Math.min(fullTables, maxPlayers);
		target = size;
	} else {
		size = maxPlayers ?? Math.ceil(people / perTable) * perTable;
		const atLeast = Math.max(fullTables, minPlayers ?? 0);
		target = Math.min(atLeast, maxPlayers ?? atLeast);
	}

	if (people < size * BOTS_FROM_SHARE) {
		return null;
	}

	const capped = Math.min(target, people * perTable);
	return Math.max(capped, registered);
}

/**
 * Moves people between tables so every table has at least one, when there are enough: a table of only bots
 * swaps one of its bots for a person from a table that has two or more.
 */
export function spreadPeople(tables: string[][], isBot: (playerId: string) => boolean): string[][] {
	const spread = tables.map((table) => [...table]);
	const peopleAt = (table: string[]) => table.filter((playerId) => !isBot(playerId));

	for (const lonely of spread) {
		if (peopleAt(lonely).length > 0) {
			continue;
		}

		const donor = spread.find((table) => peopleAt(table).length >= 2);
		if (!donor) {
			break;
		}

		const person = peopleAt(donor)[0]!;
		const botIndex = lonely.findIndex((playerId) => isBot(playerId));
		const bot = lonely[botIndex]!;

		lonely[botIndex] = person;
		donor[donor.indexOf(person)] = bot;
	}

	return spread;
}

/** Name for the n-th new bot account (0-based). */
export function botAccountName(index: number): string {
	const name = BOT_NAMES[index % BOT_NAMES.length]!;
	const round = Math.floor(index / BOT_NAMES.length);

	return round === 0 ? `Bot ${name}` : `Bot ${name} ${round + 1}`;
}

/**
 * Signs bots up for one tournament, inside the caller's transaction, once. Returns how many joined, or null when
 * it waits (nobody but bots signed up yet).
 */
export async function fillWithBots(tx: SQL, tournamentId: string): Promise<number | null> {
	const [tournament] = await tx`
		SELECT
			t.players_per_room,
			t.min_players,
			t.max_players,
			t.format,
			t.fee,
			(
				SELECT count(*)::int
				FROM tournament_players tp
				WHERE tp.tournament_id = t.id AND tp.status = 'registered'
			) AS registered,
			(
				SELECT count(*)::int
				FROM tournament_players tp
				JOIN players p ON p.id = tp.player_id
				WHERE tp.tournament_id = t.id AND tp.status = 'registered' AND NOT p.is_bot
			) AS people
		FROM tournaments t
		WHERE t.id = ${tournamentId}
			AND t.bots_added_at IS NULL
			AND t.distributed_at IS NULL
			AND t.cancelled_at IS NULL
		FOR UPDATE OF t`;

	if (!tournament) {
		return 0;
	}

	// Bots only top up a tournament its people nearly filled; until then, wait (more may still sign up).
	const target = botTarget({
		registered: tournament.registered,
		people: tournament.people,
		perTable: tournament.players_per_room,
		minPlayers: tournament.min_players,
		maxPlayers: tournament.max_players,
		format: tournament.format,
	});
	if (target === null) {
		return null;
	}

	const needed = Math.max(target - tournament.registered, 0);
	const bots = needed > 0 ? await botsFor(tx, tournamentId, needed) : [];
	const fee = Number(tournament.fee);

	for (const botId of bots) {
		await signBotUp(tx, tournamentId, botId, fee);
	}

	await tx`UPDATE tournaments SET bots_added_at = now() WHERE id = ${tournamentId}`;
	return bots.length;
}

/** Bot accounts free for this tournament, richest first, with new ones made when there aren't enough. */
async function botsFor(tx: SQL, tournamentId: string, needed: number): Promise<string[]> {
	const rows = await tx`
		SELECT p.id
		FROM players p
		LEFT JOIN wallets w ON w.player_id = p.id
		WHERE p.is_bot
			AND p.disabled_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM tournament_players tp
				WHERE tp.tournament_id = ${tournamentId} AND tp.player_id = p.id
			)
		ORDER BY coalesce(w.balance, 0) DESC, p.id
		LIMIT ${needed}`;

	const found = rows.map((row: { id: string }) => row.id);
	const missing = needed - found.length;
	if (missing === 0) {
		return found;
	}

	const [{ existing }] = await tx`SELECT count(*)::int AS existing FROM players WHERE is_bot`;
	const accounts = Array.from({ length: missing }, (_, index) => ({
		display_name: botAccountName(existing + index),
		is_bot: true,
	}));
	const made = await tx`INSERT INTO players ${tx(accounts)} RETURNING id`;

	return [...found, ...made.map((row: { id: string }) => row.id)];
}

/** Signs one bot up and takes its fee, topping its coins up first when they don't cover it. */
async function signBotUp(tx: SQL, tournamentId: string, botId: string, fee: number): Promise<void> {
	if (fee > 0) {
		const balance = await balanceOf(tx, botId);
		if (balance < fee) {
			await moveCoins(tx, { playerId: botId, amount: fee - balance, reason: "bot_funding" });
		}
	}

	await tx`
		INSERT INTO tournament_players (tournament_id, player_id, fee_paid)
		VALUES (${tournamentId}, ${botId}, ${fee})`;

	if (fee > 0) {
		await moveCoins(tx, { playerId: botId, amount: -fee, reason: "tournament_fee", tournamentId });
	}
}

/** One job step: every tournament in sign-up's last minute that hasn't had its bots yet. */
export async function fillDueWithBots(tx: TransactionSQL): Promise<number> {
	const due = await tx`
		SELECT id
		FROM tournaments
		WHERE bots_added_at IS NULL
			AND distributed_at IS NULL
			AND cancelled_at IS NULL
			AND registration_closes_at <= now() + ${BOTS_BEFORE_CLOSE}::interval
		ORDER BY registration_closes_at
		FOR UPDATE SKIP LOCKED
		LIMIT 10`;

	let filled = 0;
	for (const { id } of due) {
		try {
			const joined = await tx.savepoint((sp) => fillWithBots(sp, id));
			if (joined) {
				filled += 1;
				log.info({ msg: "tournament filled with bots", tournamentId: id, bots: joined });
			}
		} catch (err) {
			log.error({ msg: "tournament bots failed", tournamentId: id, err });
		}
	}

	return filled;
}
