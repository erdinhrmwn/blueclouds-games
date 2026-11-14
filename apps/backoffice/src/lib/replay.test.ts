import { describe, expect, test } from 'bun:test';
// The real rules and log code, so the replay is checked against what the room actually records.
import { chooseBotCard } from '../../../server/src/games/bust-31/bots';
import { logEvents, type MatchState } from '../../../server/src/games/bust-31/match';
import {
	fairRng,
	matchSeeds,
	newCommitment,
	seedsForRound
} from '../../../server/src/games/shared/fair-rng';
import {
	checkMatch,
	type MatchSeeds,
	proofsFromLog
} from '../../../server/src/games/shared/fairness';
import { closedRounds } from '../../../server/src/games/shared/rounds';
import { type LogEntry, stamp } from '../../../server/src/games/shared/match';
import {
	addPlayer,
	createGame,
	type Game,
	playCard,
	startGame
} from '../../../server/src/games/bust-31/rules';
import { type LogEvent, replay } from './replay.ts';

/** A full 4-player bot game, shuffled and logged the way the room does it (fairness events included). */
function playedGame() {
	let g = createGame();
	for (let i = 0; i < 4; i++) {
		g = addPlayer(g, `bot-${i}`, `Bot ${i}`, true);
	}

	let match: MatchState = { id: 'm', startedAt: new Date(0).toISOString(), out: [], seq: 0 };
	let seeds: MatchSeeds = { ...matchSeeds(newCommitment()), matchId: 'm' };
	let pending: LogEntry[] = [];
	const rng = fairRng(
		(round) => {
			const result = seedsForRound(seeds, round);
			seeds = result.seeds;
			if (result.started) {
				const { roundId, serverSeedHash } = seeds.current!;
				pending.push({ type: 'fairness', data: { round, roundId, serverSeedHash } });
			}

			return seeds;
		},
		(record) => {
			pending.push({ type: 'shuffle', data: record });
			seeds = { ...seeds, last: record };
		}
	);
	const events: LogEvent[] = [];
	// As the room does: a closed round reveals its seed after its moves.
	const revealsOf = (moves: LogEntry[], finished: boolean) =>
		closedRounds(moves, seeds.current?.round ?? null, finished).map((round) => {
			const seed = [seeds.previous, seeds.current].find((held) => held?.round === round)!;
			return { type: 'reveal', data: { round, serverSeed: seed.serverSeed } };
		});
	const step = (next: Game) => {
		const moves = logEvents(g, next, true);
		const entries = [...pending, ...moves, ...revealsOf(moves, next.phase === 'finished')];
		pending = [];
		const stamped = stamp(match, entries, events.length * 1000);
		match = stamped.match;
		events.push(...stamped.events);
		g = next;
	};
	g = { ...g, hostId: 'bot-0' };
	step(startGame(g, 'bot-0', rng));
	while (g.phase === 'playing') {
		const p = g.players[g.turn]!;
		step(playCard(g, p.id, chooseBotCard(p.hand, g.total)!.id, rng));
	}

	const seats = g.players.map((p) => ({ seat: p.seat, name: p.name }));
	return { game: g, log: { logVersion: 1, events }, seats };
}

describe('Bust 31 replay', () => {
	test('a whole game replays without a single mismatch and ends like the real one', () => {
		for (let n = 0; n < 20; n++) {
			const { game, log, seats } = playedGame();
			const steps = replay('bust-31', log, seats);
			expect(steps.filter((s) => s.mismatch)).toEqual([]);
			const last = steps.findLast((s) => s.event.type === 'finished')!;
			expect(last.text).toBe(`${game.players.find((p) => p.id === game.winnerId)!.name} wins.`);
			expect(steps.at(-1)!.text).toMatch(/^Round \d+ server seed revealed: /);
			expect(last.state!.seats.map((s) => s.lives)).toEqual(
				game.players.map((p) => Math.max(0, p.lives))
			);
		}
	});

	test('every round of a played game checks out with its own revealed seed', async () => {
		const { log } = playedGame();
		const proofs = proofsFromLog('m', log.events);
		const deals = log.events.filter((event) => event.type === 'deal');

		expect(proofs.length).toBe(deals.length);
		expect((await checkMatch(proofs)).ok).toBe(true);
	});

	test('a tampered log is flagged', () => {
		const { log, seats } = playedGame();
		const i = log.events.findIndex((e) => e.type === 'play');
		const tampered = log.events.map((e, j) =>
			j === i ? { ...e, data: { ...e.data, total: 99 } } : e
		);
		const steps = replay('bust-31', { ...log, events: tampered }, seats);
		expect(steps[i]!.mismatch).toContain('Total: logged 99');
	});

	test('describes timeouts and away players', () => {
		const seats = [
			{ seat: 0, name: 'Ann' },
			{ seat: 1, name: 'Bob' }
		];
		const steps = replay(
			'bust-31',
			{
				logVersion: 1,
				events: [
					{
						seq: 0,
						t: 0,
						type: 'deal',
						data: { round: 1, starter: 0, hands: { 0: ['n7-0'], 1: ['m-0'] }, deck: ['r-1'] }
					},
					{
						seq: 1,
						t: 20_000,
						type: 'play',
						seat: 0,
						data: { card: 'n7-0', total: 7, drew: 'r-1', by: 'timeout' }
					},
					{ seq: 2, t: 21_000, type: 'away', seat: 1 }
				]
			},
			seats
		);
		expect(steps.map((s) => s.text)).toEqual([
			'Round 1 dealt. Ann starts.',
			'Ann played 7. Total 7. (time ran out, played for them)',
			'Bob closed the game. Their turns are played for them.'
		]);
		expect(steps[1]!.state!.seats[0]!.hand).toEqual(['Reverse']);
		expect(steps[2]!.state!.seats[1]!.away).toBe(true);
	});
});

test('a game without a renderer shows its raw events', () => {
	const steps = replay(
		'chess',
		{ logVersion: 1, events: [{ seq: 0, t: 0, type: 'move', seat: 1, data: { from: 'e2' } }] },
		[{ seat: 1, name: 'Bob' }]
	);
	expect(steps).toEqual([
		{ event: expect.any(Object), text: 'Bob: move {"from":"e2"}', state: null }
	]);
});
