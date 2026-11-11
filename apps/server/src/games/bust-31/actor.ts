import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { chooseBotCard } from "./bots";
import { addPlayer, createGame, dealPauseMs, type Game, handOf, playCard, publicView, resetToLobby, startGame, TURN_MS } from "./rules";
import { buildReport, logEvents, type MatchState, noteMove } from "./match";
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
	requirePlayer,
	requireScheduler,
	resumeReports,
	roomVars,
	sendReports,
	turnClock,
} from "../shared/room";
import { newMatch } from "../shared/match";
import { BotIdInput } from "../shared/schema";
import { removePlayer, setAway, takeSeat } from "../shared/table";

const SLUG = "bust-31";
const rng = () => Math.random();

export const bust31Room = actor({
	db: db({ onMigrate: migrateRoom }),
	createVars: () => roomVars<Game, MatchState>(createGame()),
	onWake: async (c) => {
		await loadRoom(c);
		c.vars.game.moves ??= 0; // rooms saved before move counting existed
		c.vars.game.players.forEach((p, i) => (p.seat ??= i)); // rooms saved before fixed seats
		c.vars.logged = c.vars.game;
		await scheduleTurn(c, true);
		await resumeReports(c);
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
		/** Joins (or rejoins) the room; returns your player id and the current view. */
		join: async (c) => {
			const who = caller(c);
			const seated = c.vars.game.players.find((p) => p.id === who.id);
			if (!seated) {
				c.vars.game = apply(() => addPlayer(c.vars.game, who.id, who.name));
				await commit(c);
			} else if (seated.away) {
				c.vars.game = setAway(c.vars.game, who.id, false); // back from a closed tab
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
			requireHost(c);
			const seat = parseSeat(seatInput);
			c.vars.game = apply(() => addPlayer(c.vars.game, `bot-${crypto.randomUUID()}`, botName(c.vars.game.players), true, seat));
			await commit(c);
		},
		/** Moves you to an empty chair (lobby only). */
		takeSeat: async (c, seatInput: unknown) => {
			const me = requirePlayer(c);
			const seat = parseSeat(seatInput);
			c.vars.game = apply(() => takeSeat(c.vars.game, me, seat));
			await commit(c);
		},
		removeBot: async (c, botId: unknown) => {
			requireHost(c);
			const id = BotIdInput.parse(botId);
			if (!c.vars.game.players.find((p) => p.id === id)?.bot) throw new UserError("Bot not found.", { code: "rule" });
			c.vars.game = removePlayer(c.vars.game, id);
			await commit(c);
		},
		start: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = apply(() => startGame(c.vars.game, me, rng));
			c.vars.match = { ...newMatch(), out: [] };
			await commit(c);
		},
		play: async (c, input: unknown) => {
			const me = requirePlayer(c);
			const parsed = PlayInput.safeParse(input);
			if (!parsed.success) throw new UserError("Invalid card.", { code: "bad_input" });
			c.vars.game = apply(() => playCard(c.vars.game, me, parsed.data.cardId, rng));
			await commit(c);
		},
		reset: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = apply(() => resetToLobby(c.vars.game, me));
			await commit(c);
		},
		/** Internal (scheduler only): a closed tab did not come back. */
		dropIfGone: async (c, id: unknown) => {
			requireScheduler(c);
			const { game } = c.vars;
			if (await dropIfGone(c, id, { playerId: game.players[game.turn]?.id ?? null, key: game.moves })) await commit(c);
		},
		/** Internal (scheduler only): sends queued match results to the platform. */
		sendReports: async (c) => {
			requireScheduler(c);
			await sendReports(c);
		},
		/** Internal (scheduler only): plays for a bot, or for a human whose time ran out. */
		autoPlay: async (c, moves: unknown) => {
			requireScheduler(c);
			const { game } = c.vars;
			// A stale or duplicate timer (e.g. after a wake) must not move twice.
			if (game.phase !== "playing" || moves !== game.moves) return;
			const player = game.players[game.turn];
			const card = player && chooseBotCard(player.hand, game.total);
			if (!player || !card) return;
			const next = playCard(game, player.id, card.id, rng);
			const ev = next.lastEvent;
			const auto = !player.bot && (ev?.type === "played" || ev?.type === "bust");
			c.vars.game = auto ? { ...next, lastEvent: { ...ev, auto: true } } : next;
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
			noteMove,
			buildReport,
			view: () => viewOf(c),
			handOf: (id) => handOf(c.vars.game, id),
		},
		auto,
	);

const viewOf = (c: Ctx) => publicView(c.vars.game, turnClock(c.vars.timer));

/** Everyone gets TURN_MS; the clock of a fresh round starts once the dealer has finished dealing. */
function scheduleTurn(c: Ctx, resume: boolean): Promise<void> {
	const game = c.vars.game as Game;
	const current = game.phase === "playing" ? game.players[game.turn] : undefined;
	return armTurn(c, current, { key: game.moves, turnMs: TURN_MS, pause: dealPauseMs(game), resume, rng });
}
