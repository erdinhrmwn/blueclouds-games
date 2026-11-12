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
	botName,
	caller,
	checkConnect,
	commitRoom,
	type Ctx,
	dropIfGone,
	GONE_AFTER_MS,
	identify,
	loadRoom,
	migrateRoom,
	parseSeat,
	playerOf,
	reportToDirectory,
	requireHost,
	requireOpenTable,
	requirePlayer,
	requireScheduler,
	resumeReports,
	roomVars,
	seatFor,
	sendReports,
	tournamentTick,
	tournamentView,
	turnClock,
	wakeTournament,
} from "../shared/room";
import { type MatchState, newMatch } from "../shared/match";
import { BotIdInput } from "../shared/schema";
import { removePlayer, setAway, takeSeat } from "../shared/table";

const SLUG = "cloudburst";
/** After a bot (or the timer) draws, it plays or passes this much later, so the draw shows first. */
const AFTER_DRAW_MS = 900;

const rng = () => Math.random();

export const cloudburstRoom = actor({
	// Shown in the Rivet dashboard.
	options: { name: "Cloudburst", icon: "cloud-bolt" },
	db: db({ onMigrate: migrateRoom }),
	createVars: () => roomVars(createGame()),
	onWake: async (c) => {
		await loadRoom(c);
		await scheduleTurn(c, true);
		await resumeReports(c);
		await wakeTournament(c);
	},
	onBeforeConnect: async (_c, params: unknown) => checkConnect(params),
	onConnect: async (c, conn) => {
		if (await identify(c, conn)) await reportToDirectory(c, SLUG);
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
				await commit(c);

				// The last one in starts a tournament table.
				await tournamentTick(c, tournament(c));
			} else if (seated.away) {
				// Back from a closed tab.
				c.vars.game = setAway(c.vars.game, who.id, false);
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

			c.vars.game = apply(() => playCard(c.vars.game, me, parsed.data, rng));
			await commit(c);
		},
		draw: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = apply(() => drawCard(c.vars.game, me, rng));
			await commit(c);
		},
		pass: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = apply(() => pass(c.vars.game, me));
			await commit(c);
		},
		reset: async (c) => {
			requireOpenTable(c);
			const me = requirePlayer(c);
			c.vars.game = apply(() => resetToLobby(c.vars.game, me));
			await commit(c);
		},
		/** Internal (scheduler only): a closed tab did not come back. */
		dropIfGone: async (c, id: unknown) => {
			requireScheduler(c);
			const { game } = c.vars;
			const turn = { playerId: game.players[game.turn]?.id ?? null, key: game.turnKey };

			const dropped = await dropIfGone(c, id, turn);
			if (dropped) await commit(c);
		},
		/** Internal (scheduler only): a tournament table's start time, or the end of its wait for late players. */
		tournamentStart: async (c) => {
			requireScheduler(c);
			await tournamentTick(c, tournament(c));
		},
		/** Internal (scheduler only): sends queued match results to the platform. */
		sendReports: async (c) => {
			requireScheduler(c);
			await sendReports(c);
		},
		/** Internal (scheduler only): moves for a bot, or for a human whose time ran out. */
		autoPlay: async (c, key: unknown) => {
			requireScheduler(c);
			const { game } = c.vars;
			// A stale or duplicate timer (e.g. after a wake) must not move twice.
			if (game.phase !== "playing" || key !== game.turnKey) return;

			const player = game.players[game.turn]!;
			const move = chooseBotMove(game);

			let next: Game;
			if (move.type === "play") {
				next = playCard(game, player.id, move.input, rng);
			} else if (move.type === "draw") {
				next = drawCard(game, player.id, rng);
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
const commit = (c: Ctx, auto = false) =>
	commitRoom<Game, MatchState>(
		c,
		{
			slug: SLUG,
			scheduleTurn: () => scheduleTurn(c, false),
			logEvents,
			buildReport,
			view: () => viewOf(c),
			handOf: (id) => handOf(c.vars.game, id),
		},
		auto,
	);

const viewOf = (c: Ctx) => ({
	...publicView(c.vars.game, turnClock(c.vars.timer)),
	tournament: tournamentView(c),
});

/** Starts the match; `by` must be the host. */
function begin(c: Ctx, by: string): void {
	c.vars.game = apply(() => startGame(c.vars.game, by, rng));
	c.vars.match = newMatch();
}

/** How a tournament table starts itself: as its host would. */
const tournament = (c: Ctx) => ({
	start: () => begin(c, c.vars.game.hostId),
	commit: () => commit(c),
});

/** Everyone gets TURN_MS; a fresh round's clock starts after the round summary and the deal. */
function scheduleTurn(c: Ctx, resume: boolean): Promise<void> {
	const game = c.vars.game as Game;
	const current = game.phase === "playing" ? game.players[game.turn] : undefined;
	return armTurn(c, current, {
		key: game.turnKey,
		turnMs: TURN_MS,
		pause: dealPauseMs(game),
		resume,
		rng,
	});
}
