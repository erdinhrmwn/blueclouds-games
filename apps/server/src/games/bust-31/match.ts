import type { Card, Game, Player } from "./rules";
import {
	type LogEntry,
	type LogEvent,
	type MatchEnd,
	type MatchReport,
	type MatchState as SharedMatch,
	moveBy,
	placementsInOrder,
} from "../shared/match";
import type { RoundResult } from "../shared/rounds";

/** Bump when a rule change makes old results incomparable to new ones. */
/** 2: Swap, Ten and Double joined the deck. */
export const RULES_VERSION = 2;
/** Bump when the shape of a log event changes (see docs/architecture/match-log.md). */
export const LOG_VERSION = 1;

/** The game in progress. `out` lists player ids in the order they were eliminated. */
export type MatchState = SharedMatch & { out: string[] };

/** Notes who lost their last life on the move that produced `game`. Call after every move. */
export function noteMove(match: MatchState, game: Game): MatchState {
	const out = game.players
		.filter((p) => p.lives <= 0 && !match.out.includes(p.id))
		.map((p) => p.id);

	return out.length ? { ...match, out: [...match.out, ...out] } : match;
}

/**
 * The result of a match. Finished: the winner places 1st, the last one out 2nd, and so on. Terminated: the players
 * still in, most lives first (then by seat), ahead of those out, the last one out first.
 */
export function buildReport(
	match: MatchState,
	game: Game,
	roomCode: string,
	endedAt: string,
	events: LogEvent[],
	end: MatchEnd = "finished",
): MatchReport {
	if (end === "finished" && (game.phase !== "finished" || !game.winnerId)) {
		throw new Error("buildReport needs a finished game");
	}

	const { out } = noteMove(match, game);
	const placement = end === "finished" ? finishedPlacements(game, out) : standings(game, out);

	return {
		matchId: match.id,
		game: "bust-31",
		roomCode,
		rulesVersion: RULES_VERSION,
		startedAt: match.startedAt,
		endedAt,
		endReason: end,
		players: game.players.map((p) => ({
			seat: p.seat,
			playerId: p.bot ? null : p.id,
			bot: p.bot,
			...(p.bot ? { botName: p.name } : {}),
			placement: placement.get(p.id)!,
			// Bust 31 scores lives left.
			score: Math.max(0, p.lives),
		})),
		log: { logVersion: LOG_VERSION, events },
	};
}

/** The winner 1st, then the players out, the last one out first. */
function finishedPlacements(game: Game, out: string[]): Map<string, number> {
	const placeOf = (id: string) => {
		if (id === game.winnerId) {
			return 1;
		}

		return out.length - out.indexOf(id) + 1;
	};

	return new Map(game.players.map((p) => [p.id, placeOf(p.id)]));
}

/** Where everyone stands mid-game: players still in by lives (then seat), then the players out, last out first. */
function standings(game: Game, out: string[]): Map<string, number> {
	const stillIn = game.players
		.filter((p) => !out.includes(p.id))
		.sort((a, b) => b.lives - a.lives || a.seat - b.seat);
	const lastOutFirst = [...out].reverse().map((id) => ({ id }));

	return placementsInOrder([...stillIn, ...lastOutFirst]);
}

/**
 * The log entries for one committed change of a running match, from the state before and after it.
 * `auto` is true when the server made the move (a bot, a timeout, or an away player).
 * Hands and deck order are included: the log only leaves the room once the match is over.
 */
export function logEvents(before: Game, after: Game, auto = false): LogEntry[] {
	const entries: LogEntry[] = awayChanges(before, after);
	if (after.moves === before.moves || after.phase === "lobby") return entries;

	const event = after.lastEvent;
	const mover = before.phase === "playing" ? before.players[before.turn] : undefined;

	if (mover && event?.type !== "started") {
		const now = after.players.find((p) => p.id === mover.id)!;
		const by = moveBy(mover, auto);

		// "finished" replaces the bust in lastEvent; the card is then the one that left the hand.
		const card =
			event?.type === "played" || event?.type === "bust"
				? event.card
				: missing(mover.hand, now.hand);

		if (event?.type === "played") {
			// Swap: the drawn card went to the seat that traded hands with the mover.
			const swappedWith = after.players.find((p) => p.id === event.swappedWith);
			const holder = swappedWith ?? now;
			const drew = drawn(mover, holder);

			if (before.deck.length === 0) {
				entries.push({
					type: "reshuffle",
					data: { deck: [...drew, ...ids(after.deck)] },
				});
			}

			const data: Record<string, unknown> = {
				card: card.id,
				total: after.total,
				drew: drew[0] ?? null,
				by,
			};
			if (swappedWith) {
				data.swapped = swappedWith.seat;
			}

			entries.push({ type: "play", seat: mover.seat, data });
		} else {
			const total = event?.type === "bust" ? event.total : after.total;
			entries.push({
				type: "bust",
				seat: mover.seat,
				data: {
					card: card.id,
					total,
					lives: Math.max(0, now.lives),
					eliminated: now.lives <= 0,
					by,
				},
			});
		}
	}

	const newRound = event?.type === "started" || event?.type === "bust";
	if (after.phase === "playing" && newRound) {
		const alive = after.players.filter((p) => p.lives > 0);
		const hands = Object.fromEntries(alive.map((p) => [p.seat, ids(p.hand)]));

		entries.push({
			type: "deal",
			data: {
				round: after.round,
				starter: after.players[after.turn]!.seat,
				hands,
				deck: ids(after.deck),
			},
		});
	}

	if (after.phase === "finished") {
		const winner = after.players.find((p) => p.id === after.winnerId)!;
		entries.push({ type: "finished", data: { winner: winner.seat } });
	}

	return entries;
}

/** "away" / "back" entries for players whose away flag changed mid-match. */
function awayChanges(before: Game, after: Game): LogEntry[] {
	if (before.phase !== "playing") return [];

	const entries: LogEntry[] = [];
	for (const player of after.players) {
		const was = before.players.find((p) => p.id === player.id);
		if (was && !!was.away !== !!player.away) {
			entries.push({ type: player.away ? "away" : "back", seat: player.seat });
		}
	}

	return entries;
}

const ids = (cards: Card[]) => cards.map((card) => card.id);

const hasCard = (cards: Card[], card: Card) => cards.some((other) => other.id === card.id);

/** The card in `from` that is not in `to` (the one just played, when no new hand was dealt). */
const missing = (from: Card[], to: Card[]) => from.find((card) => !hasCard(to, card))!;

/** The card a player drew after playing: in their new hand but not their old one. */
const drawn = (before: Player, after: Player) =>
	ids(after.hand.filter((card) => !hasCard(before.hand, card)));

/** A Bust 31 round's summary: the seat that busted, its card and total, and the lives it kept. */
export const roundResult: RoundResult = (events) => {
	const bust = events.find((event) => event.type === "bust");
	if (!bust) {
		return {};
	}

	return { seat: bust.seat, ...bust.data };
};
