import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { chooseBotMove } from "./bots";
import { buildReport, type MatchState } from "./match";
import { addPlayer, createGame, dealPauseMs, drawCard, type Game, handOf, pass, playCard, publicView, resetToLobby, startGame, TURN_MS } from "./rules";
import { PlayInput } from "./schema";
import {
	apply,
	armTurn,
	botName,
	broadcast,
	caller,
	checkConnect,
	type Ctx,
	dropIfGone,
	GONE_AFTER_MS,
	identify,
	parseSeat,
	playerOf,
	queueReport,
	reportToDirectory,
	REPORTS_TABLE,
	requireHost,
	requirePlayer,
	requireScheduler,
	resumeReports,
	type RoomVars,
	sendReports,
	turnClock,
} from "../shared/room";
import { uuidv7 } from "../shared/match";
import { BotIdInput } from "../shared/schema";
import { removePlayer, setAway, takeSeat } from "../shared/table";

const SLUG = "cloudburst";
/** After a bot (or the timer) draws, it plays or passes this much later, so the draw shows first. */
const AFTER_DRAW_MS = 900;

type Saved = Omit<RoomVars<Game>, "who"> & {
	/** The match being played, for its result. Null in the lobby and once the result is queued. */
	match: MatchState | null;
};
type Vars = RoomVars<Game> & Saved;

const rng = () => Math.random();

export const cloudburstRoom = actor({
	// The whole room is a few KB, so one JSON row is enough.
	db: db({
		onMigrate: async (d) => {
			await d.execute("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)");
			await d.execute(REPORTS_TABLE);
		},
	}),
	createVars: (): Vars => ({ game: createGame(), who: {}, timer: null, match: null }),
	onWake: async (c) => {
		const rows = await c.db.execute<{ data: string }>("SELECT data FROM room WHERE id = 1");
		if (rows[0]) Object.assign(c.vars, JSON.parse(rows[0].data) as Saved);
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
		/** Joins (or rejoins) the room; returns your player id, the current view and your hand. */
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
			c.vars.match = { id: uuidv7(), startedAt: new Date().toISOString() };
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
			const me = requirePlayer(c);
			c.vars.game = apply(() => resetToLobby(c.vars.game, me));
			await commit(c);
		},
		/** Internal (scheduler only): a closed tab did not come back. */
		dropIfGone: async (c, id: unknown) => {
			requireScheduler(c);
			const { game } = c.vars;
			if (await dropIfGone(c, id, { playerId: game.players[game.turn]?.id ?? null, key: game.turnKey })) await commit(c);
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
			const next =
				move.type === "play" ? playCard(game, player.id, move.input, rng) : move.type === "draw" ? drawCard(game, player.id, rng) : pass(game, player.id);
			const ev = next.lastEvent;
			const mark = !player.bot && (ev?.type === "played" || ev?.type === "drew" || ev?.type === "passed");
			c.vars.game = mark ? { ...next, lastEvent: { ...ev, auto: true } } : next;
			if (move.type === "draw") await c.schedule.after(AFTER_DRAW_MS, "autoPlay", game.turnKey);
			await commit(c);
		},
	},
});

/** Persist, then push the public view to everyone and each hand to its owner. */
async function commit(c: Ctx): Promise<void> {
	await scheduleTurn(c, false);
	const finished = await trackMatch(c);
	const saved: Saved = { game: c.vars.game, timer: c.vars.timer, match: c.vars.match };
	await c.db.execute(
		"INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
		JSON.stringify(saved),
	);
	broadcast(c, viewOf(c), (id) => handOf(c.vars.game, id));
	await reportToDirectory(c, SLUG); // after the players got their update, so the list never slows a move
	if (finished) await c.schedule.after(0, "sendReports");
}

/** Once the match is over, queues its result. Returns true when it queued one. */
async function trackMatch(c: Ctx): Promise<boolean> {
	const { game, match } = c.vars as Saved;
	if (!match || game.phase !== "finished") return false;
	await queueReport(c, buildReport(match, game, c.key[0] as string, new Date().toISOString()));
	c.vars.match = null;
	return true;
}

const viewOf = (c: Ctx) => publicView(c.vars.game, turnClock(c.vars.timer));

/** Everyone gets TURN_MS; a fresh round's clock starts after the round summary and the deal. */
function scheduleTurn(c: Ctx, resume: boolean): Promise<void> {
	const game = c.vars.game as Game;
	const current = game.phase === "playing" ? game.players[game.turn] : undefined;
	return armTurn(c, current, { key: game.turnKey, turnMs: TURN_MS, pause: dealPauseMs(game), resume, rng });
}
