import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { chooseBotCard } from "./bots";
import {
	addPlayer,
	createGame,
	dealPauseMs,
	type Game,
	handOf,
	MAX_PLAYERS,
	playCard,
	publicView,
	removePlayer,
	resetToLobby,
	RuleError,
	setAway,
	startGame,
	takeSeat,
	TURN_MS,
} from "./rules";
import { BotIdInput, ConnParams, PlayInput, SeatInput } from "./schema";

/** How long a closed tab has to come back (a refresh) before its player leaves the table. */
const GONE_AFTER_MS = 15_000;
/** A bot gets the same turn clock as a human; it just decides within this range (random). */
const BOT_THINK_MS = [1500, 4000] as const;
const BOT_NAMES = ["Bot Cloud", "Bot Rain", "Bot Thunder", "Bot Rainbow", "Bot Wind"];

type Saved = {
	game: Game;
	tokens: Record<string, string>;
	/** Game position the current turn timer belongs to, when it runs out (epoch ms), and its full length. */
	timer: { moves: number; endsAt: number; total: number } | null;
};

const rng = () => Math.random();

/** Turns rule violations into errors the client is allowed to see. */
function apply<T>(fn: () => T): T {
	try {
		return fn();
	} catch (err) {
		if (err instanceof RuleError) throw new UserError(err.message, { code: "rule" });
		throw err;
	}
}

export const bust31Room = actor({
	// The whole room is a few KB, so one JSON row is enough.
	db: db({
		onMigrate: async (d) => {
			await d.execute("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)");
		},
	}),
	createVars: (): Saved => ({ game: createGame(), tokens: {}, timer: null }),
	onWake: async (c) => {
		const rows = await c.db.execute<{ data: string }>("SELECT data FROM room WHERE id = 1");
		if (rows[0]) Object.assign(c.vars, JSON.parse(rows[0].data) as Saved);
		c.vars.game.moves ??= 0; // rooms saved before move counting existed
		c.vars.timer ??= null;
		c.vars.game.players.forEach((p, i) => (p.seat ??= i)); // rooms saved before fixed seats
		await scheduleTurn(c, true);
	},
	onBeforeConnect: (_c, params: unknown) => {
		if (!ConnParams.safeParse(params).success) throw new UserError("Invalid name or session.", { code: "bad_params" });
	},
	onConnect: async (c) => {
		await reportToDirectory(c);
	},
	onDisconnect: async (c, conn) => {
		await reportToDirectory(c, conn.id);
		const id = playerOf(c, conn);
		if (id) await c.schedule.after(GONE_AFTER_MS, "dropIfGone", id);
	},
	actions: {
		/** Joins (or rejoins) the room; returns your player id and the current view. */
		join: async (c) => {
			const { token, name } = ConnParams.parse(c.conn.params);
			let playerId = c.vars.tokens[token];
			if (!playerId) {
				playerId = crypto.randomUUID();
				c.vars.game = apply(() => addPlayer(c.vars.game, playerId!, name));
				c.vars.tokens[token] = playerId;
				await commit(c);
			} else if (c.vars.game.players.find((p) => p.id === playerId)?.away) {
				c.vars.game = setAway(c.vars.game, playerId, false); // back from a closed tab
				await commit(c);
			}
			return { playerId, view: viewOf(c), hand: handOf(c.vars.game, playerId) };
		},
		leave: async (c) => {
			const me = requirePlayer(c);
			c.vars.game = removePlayer(c.vars.game, me);
			if (!c.vars.game.players.some((p) => p.id === me)) {
				const token = ConnParams.parse(c.conn.params).token;
				delete c.vars.tokens[token];
			}
			await commit(c);
		},
		/** Host only: seats a bot in the given empty chair. */
		addBot: async (c, seatInput: unknown) => {
			requireHost(c);
			const seat = parseSeat(seatInput);
			const used = new Set(c.vars.game.players.map((p) => p.name));
			const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${c.vars.game.players.length + 1}`;
			c.vars.game = apply(() => addPlayer(c.vars.game, `bot-${crypto.randomUUID()}`, name, true, seat));
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
		/**
		 * Internal (scheduler only): a player's last connection closed a while ago and none came back.
		 * In the lobby they leave the table; mid-game their seat stays and is played for them.
		 */
		dropIfGone: async (c, id: unknown) => {
			if (!c.scheduledFire) throw new UserError("Not allowed.", { code: "forbidden" });
			const { game } = c.vars as Saved;
			const player = game.players.find((p) => p.id === id);
			if (!player || [...c.conns.values()].some((conn) => playerOf(c, conn) === id)) return;
			if (game.phase === "lobby") {
				c.vars.game = removePlayer(game, player.id);
				for (const [token, pid] of Object.entries(c.vars.tokens)) if (pid === player.id) delete c.vars.tokens[token];
			} else {
				c.vars.game = setAway(game, player.id, true);
				// Their turn may be running on the full human clock: play it at bot speed instead.
				if (game.phase === "playing" && game.players[game.turn]?.id === player.id) {
					await c.schedule.after(BOT_THINK_MS[0], "autoPlay", game.moves);
				}
			}
			await commit(c);
		},
		/** Internal: fired by the scheduler, never by clients. Plays for a bot, or for a human whose time ran out. */
		autoPlay: async (c, moves: unknown) => {
			if (!c.scheduledFire) throw new UserError("Not allowed.", { code: "forbidden" });
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
			await commit(c);
		},
	},
});

// ponytail: helpers take `any` because rivetkit's context generics are long;
// they only touch c.vars, c.conn, c.db, c.conns and c.schedule.
type Ctx = any;

function parseSeat(input: unknown): number {
	const parsed = SeatInput.safeParse(input);
	if (!parsed.success) throw new UserError("That seat does not exist.", { code: "bad_input" });
	return parsed.data;
}

function playerOf(c: Ctx, conn: { params: unknown }): string | undefined {
	const parsed = ConnParams.safeParse(conn.params);
	return parsed.success ? c.vars.tokens[parsed.data.token] : undefined;
}

function requirePlayer(c: Ctx): string {
	const token = ConnParams.parse(c.conn.params).token;
	const id = c.vars.tokens[token] as string | undefined;
	if (!id) throw new UserError("Join the table first.", { code: "not_joined" });
	return id;
}

function requireHost(c: Ctx): void {
	if (c.vars.game.hostId !== requirePlayer(c)) throw new UserError("Only the host can do that.", { code: "rule" });
}

/** Persist, then push the public view to everyone and each hand to its owner. */
async function commit(c: Ctx): Promise<void> {
	await scheduleTurn(c, false);
	const saved: Saved = { game: c.vars.game, tokens: c.vars.tokens, timer: c.vars.timer };
	await c.db.execute(
		"INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
		JSON.stringify(saved),
	);
	c.broadcast("view", viewOf(c));
	for (const conn of c.conns.values()) {
		const parsed = ConnParams.safeParse(conn.params);
		const id = parsed.success ? c.vars.tokens[parsed.data.token] : undefined;
		if (id) conn.send("hand", handOf(c.vars.game, id));
	}
	await reportToDirectory(c); // after the players got their update, so the list never slows a move
}

/**
 * Keeps this table's line in the room list current. A table with nobody connected is
 * taken off the list (bots alone don't count). `leaving` is a connection that is closing.
 * The list is a convenience, so a failure is logged and the game carries on.
 */
async function reportToDirectory(c: Ctx, leaving?: string): Promise<void> {
	const code = c.key[0] as string;
	const directory = c.client().bust31Rooms.getOrCreate(["main"]);
	const connected = [...c.conns.values()].filter((conn: { id: string }) => conn.id !== leaving).length;
	const { game } = c.vars as Saved;
	try {
		if (connected === 0) {
			await directory.remove(code);
			return;
		}
		const host = game.players.find((p) => p.id === game.hostId)?.name ?? null;
		await directory.report({ code, host, players: game.players.length, maxPlayers: MAX_PLAYERS, phase: game.phase });
	} catch (err) {
		c.log.warn({ msg: "room list update failed", code, err: String(err) });
	}
}

function viewOf(c: Ctx) {
	const timer = c.vars.timer as Saved["timer"];
	return publicView(c.vars.game, timer && { left: Math.max(0, timer.endsAt - Date.now()), total: timer.total ?? TURN_MS });
}

/**
 * Arms the timer for the current turn: a short think time for bots, TURN_MS for humans.
 * Runs on every commit but only arms once per game position; `resume` re-arms after a wake.
 */
async function scheduleTurn(c: Ctx, resume: boolean): Promise<void> {
	const { game, timer } = c.vars as Saved;
	const current = game.phase === "playing" ? game.players[game.turn] : undefined;
	if (!current) {
		c.vars.timer = null;
		return;
	}
	if (timer?.moves === game.moves && !resume) return;
	const pause = timer?.moves === game.moves ? 0 : dealPauseMs(game);
	if (timer?.moves === game.moves) {
		// Resuming after a wake: keep the deadline players already saw. Rooms saved before `total` existed get TURN_MS.
		c.vars.timer = { ...timer, total: timer.total ?? TURN_MS };
	} else {
		// Everyone gets TURN_MS; the clock starts once the dealer has finished dealing a new round.
		c.vars.timer = { moves: game.moves, endsAt: Date.now() + pause + TURN_MS, total: TURN_MS };
	}
	const untilTimeout = Math.max(0, c.vars.timer.endsAt - Date.now());
	const [min, max] = BOT_THINK_MS;
	// A bot plays once it has "decided", which stops its clock early, like a quick human.
	const delay = current.bot || current.away ? Math.min(untilTimeout, pause + min + Math.round(rng() * (max - min))) : untilTimeout;
	await c.schedule.after(delay, "autoPlay", game.moves);
}
