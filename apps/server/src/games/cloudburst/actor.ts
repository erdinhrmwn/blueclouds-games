import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { chooseBotMove } from "./bots";
import { buildReport, logEvents } from "./match";
import {
	addPlayer,
	createGame,
	dealPauseMs,
	drawCard,
	type Game,
	handOf,
	pass,
	playCard,
	publicView,
	resetToLobby,
	startGame,
	TURN_MS,
} from "./rules";
import { PlayInput } from "./schema";
import {
	apply,
	armTurn,
	armVipRefresh,
	botName,
	caller,
	checkConnect,
	closeKicked,
	closeTerminated,
	beginMatch,
	commitRoom,
	type Ctx,
	dropIfGone,
	fairnessView,
	GONE_AFTER_MS,
	identify,
	kickFromTable,
	lastProof,
	loadRoom,
	migrateRoom,
	parseSeat,
	playerOf,
	refreshVips,
	reportToDirectory,
	requireAdmin,
	requireHost,
	requireOpenTable,
	requirePlayer,
	requireScheduler,
	resumeReports,
	roomVars,
	scheduledWhileOpen,
	seatFor,
	sendReports,
	terminateTable,
	tournamentTick,
	tournamentView,
	turnClock,
	wakeTournament,
	withRng,
} from "../shared/room";
import type { LogEntry, MatchState } from "../shared/match";
import { AdminKickInput, AdminTerminateInput, BotIdInput } from "../shared/schema";
import { markBack, markVip, removePlayer, takeSeat } from "../shared/table";

const SLUG = "cloudburst";
/** After a bot (or the timer) draws, it plays or passes this much later, so the draw shows first. */
const AFTER_DRAW_MS = 900;

export const cloudburstRoom = actor({
	// Shown in the Rivet dashboard.
	options: { name: "Cloudburst", icon: "cloud-bolt" },
	db: db({ onMigrate: migrateRoom }),
	createVars: () => roomVars(createGame()),
	onWake: async (c) => {
		await loadRoom(c);
		await resumeTurn(c);
		await resumeReports(c);
		await wakeTournament(c);
	},
	onBeforeConnect: async (c, params: unknown) => checkConnect(c, params),
	onConnect: async (c, conn) => {
		if (!(await identify(c, conn))) return;

		await reportToDirectory(c, SLUG);
		await armVipRefresh(c);
	},
	onDisconnect: async (c, conn) => {
		const id = playerOf(c, conn);
		delete c.vars.who[conn.id];

		await reportToDirectory(c, SLUG, conn.id);
		if (id) await c.schedule.after(GONE_AFTER_MS, "dropIfGone", id);
	},
	actions: {
		/** Joins (or rejoins) the room; returns your player id, the current view and your hand. */
		join: async (c) => {
			const who = caller(c);
			const seated = c.vars.game.players.find((p) => p.id === who.id);

			if (!seated) {
				const seat = await seatFor(c, who);
				c.vars.game = apply(() => addPlayer(c.vars.game, who.id, who.name, false, seat));

				if (who.vip) {
					c.vars.game = markVip(c.vars.game, who.id);
				}

				await commit(c);

				// The last one in starts a tournament table.
				await tournamentTick(c, tournament(c));
			} else if (seated.away) {
				// Back from a closed tab.
				c.vars.game = markBack(c.vars.game, who.id);
				await commit(c);
			}

			return { playerId: who.id, view: viewOf(c), hand: handOf(c.vars.game, who.id) };
		},
		leave: async (c) => {
			c.vars.game = removePlayer(c.vars.game, requirePlayer(c));
			await commit(c);
		},
		/** Host only: seats a bot in the given empty chair. */
		addBot: async (c, seatInput: unknown) => {
			requireOpenTable(c);
			requireHost(c);
			const seat = parseSeat(seatInput);
			const botId = `bot-${crypto.randomUUID()}`;
			const name = botName(c.vars.game.players);

			c.vars.game = apply(() => addPlayer(c.vars.game, botId, name, true, seat));
			await commit(c);
		},
		/** Moves you to an empty chair (lobby only). */
		takeSeat: async (c, seatInput: unknown) => {
			requireOpenTable(c);
			const me = requirePlayer(c);
			const seat = parseSeat(seatInput);
			c.vars.game = apply(() => takeSeat(c.vars.game, me, seat));
			await commit(c);
		},
		removeBot: async (c, botId: unknown) => {
			requireOpenTable(c);
			requireHost(c);
			const id = BotIdInput.parse(botId);
			const bot = c.vars.game.players.find((p) => p.id === id);
			if (!bot?.bot) {
				throw new UserError("Bot not found.", { code: "rule" });
			}

			c.vars.game = removePlayer(c.vars.game, id);
			await commit(c);
		},
		/** Host only, in the lobby: takes a player off the table; they can't come back to it. */
		kick: async (c, seatInput: unknown) => {
			requireOpenTable(c);
			const hostId = requireHost(c);
			const seat = parseSeat(seatInput);

			const kick = kickFromTable(c, seat, { kind: "host", hostId });
			await commit(c, false, kick.entries);
			await closeKicked(c, kick.result.playerId, currentTurn(c));
		},
		/** Backoffice only: kicks a player off the table, in the lobby or mid-game. */
		adminKick: async (c, input: unknown) => {
			requireAdmin(c);
			const parsed = AdminKickInput.safeParse(input);
			if (!parsed.success) {
				throw new UserError("Pick a seat and give a reason.", { code: "bad_input" });
			}

			const by = { kind: "admin" as const, reason: parsed.data.reason };
			const kick = kickFromTable(c, parsed.data.seat, by);
			await commit(c, false, kick.entries);
			await closeKicked(c, kick.result.playerId, currentTurn(c));

			return kick.result;
		},
		/** Backoffice only: ends the table for good; a running match is saved as terminated. */
		adminTerminate: async (c, input: unknown) => {
			requireAdmin(c);
			const parsed = AdminTerminateInput.safeParse(input);
			if (!parsed.success) {
				throw new UserError("Give a reason.", { code: "bad_input" });
			}

			const termination = terminateTable(c, parsed.data.reason);
			await commit(c, false, termination.entries);
			await closeTerminated(c, termination.result);

			return termination.result;
		},
		start: async (c) => {
			requireOpenTable(c);
			begin(c, requirePlayer(c));
			await commit(c);
		},
		/** Plays a card: `suit` for a Rainbow, `giveId` (the card to hand on) for a Gust. */
		play: async (c, input: unknown) => {
			const me = requirePlayer(c);
			const parsed = PlayInput.safeParse(input);
			if (!parsed.success) throw new UserError("Invalid move.", { code: "bad_input" });

			c.vars.game = withRng(c, (rng) => playCard(c.vars.game, me, parsed.data, rng));
			await commit(c);
		},
		draw: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = withRng(c, (rng) => drawCard(c.vars.game, me, rng));
			await commit(c);
		},
		pass: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = apply(() => pass(c.vars.game, me));
			await commit(c);
		},
		/** The last match's seeds and shuffles, so a player can check it was dealt fairly. */
		fairnessProof: async (c) => {
			caller(c);

			return lastProof(c);
		},
		reset: async (c) => {
			requireOpenTable(c);
			const me = requirePlayer(c);
			c.vars.game = apply(() => resetToLobby(c.vars.game, me));
			await commit(c);
		},
		/** Internal (scheduler only): a closed tab did not come back. */
		dropIfGone: async (c, id: unknown) => {
			if (!scheduledWhileOpen(c)) {
				return;
			}

			const dropped = await dropIfGone(c, id, currentTurn(c));
			if (dropped) await commit(c);
		},
		/** Internal (scheduler only): shows a VIP grant or revoke on a seated player's tag. */
		refreshVips: async (c, at: unknown) => {
			if (!scheduledWhileOpen(c)) {
				return;
			}

			const changed = await refreshVips(c, at);
			if (changed) await commit(c);
		},
		/** Internal (scheduler only): a tournament table's start time, or the end of its wait for late players. */
		tournamentStart: async (c) => {
			if (!scheduledWhileOpen(c)) {
				return;
			}

			await tournamentTick(c, tournament(c));
		},
		/** Internal (scheduler only): sends queued match results to the platform. */
		sendReports: async (c) => {
			requireScheduler(c);
			await sendReports(c);
		},
		/** Internal (scheduler only): moves for a bot, or for a human whose time ran out. */
		autoPlay: async (c, key: unknown) => {
			if (!scheduledWhileOpen(c)) {
				return;
			}

			const { game } = c.vars;
			// A stale or duplicate timer (e.g. after a wake) must not move twice.
			if (game.phase !== "playing" || key !== game.turnKey) return;

			const player = game.players[game.turn]!;
			const move = chooseBotMove(game);

			let next: Game;
			if (move.type === "play") {
				next = withRng(c, (rng) => playCard(game, player.id, move.input, rng));
			} else if (move.type === "draw") {
				next = withRng(c, (rng) => drawCard(game, player.id, rng));
			} else {
				next = pass(game, player.id);
			}

			// A move made for a human (timeout or away) is marked so the table can say so.
			const event = next.lastEvent;
			const isMove = event?.type === "played" || event?.type === "drew" || event?.type === "passed";
			const playedForHuman = !player.bot && isMove;
			c.vars.game = playedForHuman ? { ...next, lastEvent: { ...event, auto: true } } : next;

			// After a draw the same turn goes on: play or pass a moment later.
			if (move.type === "draw") {
				await c.schedule.after(AFTER_DRAW_MS, "autoPlay", game.turnKey);
			}

			await commit(c, true);
		},
	},
});

/** Saves the change (with its move log), then pushes the view to everyone and each hand to its owner. */
const commit = (c: Ctx, auto = false, extra: LogEntry[] = []) =>
	commitRoom<Game, MatchState>(
		c,
		{
			slug: SLUG,
			scheduleTurn: () => scheduleTurn(c),
			logEvents,
			buildReport,
			view: () => viewOf(c),
			handOf: (id) => handOf(c.vars.game, id),
		},
		auto,
		extra,
	);

/** The running turn: whose it is and its key, for scheduling a move made for them. */
function currentTurn(c: Ctx): { playerId: string | null; key: number } {
	const game = c.vars.game as Game;
	const playerId = game.players[game.turn]?.id ?? null;

	return { playerId, key: game.turnKey };
}

const viewOf = (c: Ctx) => ({
	...publicView(c.vars.game, turnClock(c.vars.timer)),
	tournament: tournamentView(c),
	fairness: fairnessView(c),
});

/** Starts the match; `by` must be the host. */
function begin(c: Ctx, by: string): void {
	beginMatch<Game, MatchState>(c, {}, (rng) => startGame(c.vars.game, by, rng));
}

/** How a tournament table starts itself: as its host would. */
const tournament = (c: Ctx) => ({
	start: () => begin(c, c.vars.game.hostId),
	commit: () => commit(c),
});

/** Arms the clock when a new turn starts; a no-op while the same turn runs. */
const scheduleTurn = (c: Ctx) => armTurnClock(c, { resume: false });

/** After a wake: re-arms the running turn and keeps the deadline players already saw. */
const resumeTurn = (c: Ctx) => armTurnClock(c, { resume: true });

/** Everyone gets TURN_MS; a fresh round's clock starts after the round summary and the deal. */
function armTurnClock(c: Ctx, { resume }: { resume: boolean }): Promise<void> {
	const game = c.vars.game as Game;
	const current = game.phase === "playing" ? game.players[game.turn] : undefined;
	return armTurn(c, current, {
		key: game.turnKey,
		turnMs: TURN_MS,
		pause: dealPauseMs(game),
		resume,
		rng: Math.random,
	});
}
