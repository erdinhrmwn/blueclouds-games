import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { chooseBotCard } from "./bots";
import {
	addPlayer,
	createGame,
	type Game,
	handOf,
	MAX_PLAYERS,
	playCard,
	publicView,
	removePlayer,
	resetToLobby,
	RuleError,
	startGame,
	TURN_MS,
} from "./rules";
import { BotIdInput, ConnParams, PlayInput } from "./schema";

const BOT_DELAY_MS = 900;
const BOT_NAMES = ["Bot Cloud", "Bot Rain", "Bot Thunder", "Bot Rainbow", "Bot Wind"];

type Saved = {
	game: Game;
	tokens: Record<string, string>;
	/** Game position the current turn timer belongs to, and when it runs out (epoch ms). */
	timer: { moves: number; endsAt: number } | null;
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
		await scheduleTurn(c, true);
	},
	onBeforeConnect: (_c, params: unknown) => {
		if (!ConnParams.safeParse(params).success) throw new UserError("Invalid name or session.", { code: "bad_params" });
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
		addBot: async (c) => {
			requireHost(c);
			const used = new Set(c.vars.game.players.map((p) => p.name));
			const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${c.vars.game.players.length + 1}`;
			if (c.vars.game.players.length >= MAX_PLAYERS) throw new UserError("This table is full.", { code: "rule" });
			c.vars.game = apply(() => addPlayer(c.vars.game, `bot-${crypto.randomUUID()}`, name, true));
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
}

function viewOf(c: Ctx) {
	const timer = c.vars.timer as Saved["timer"];
	return publicView(c.vars.game, timer ? Math.max(0, timer.endsAt - Date.now()) : null);
}

/**
 * Arms the timer for the current turn: a short delay for bots, TURN_MS for humans.
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
	if (current.bot) {
		c.vars.timer = null;
		await c.schedule.after(BOT_DELAY_MS, "autoPlay", game.moves);
		return;
	}
	const endsAt = timer?.moves === game.moves ? timer.endsAt : Date.now() + TURN_MS;
	c.vars.timer = { moves: game.moves, endsAt };
	await c.schedule.after(Math.max(0, endsAt - Date.now()), "autoPlay", game.moves);
}
