<script lang="ts">
	import { LIMIT } from 'server/games/bust-31/rules';
	import { BURST_AT } from 'server/games/cloudburst/rules';
	import { cardFace } from '#lib/rounds.ts';

	/**
	 * What happened in a closed round, from the game's own summary (rounds.ts in the game server). Bust 31: who
	 * busted, on which card and total, and the lives they kept. Cloudburst: who went out first, and each seat's
	 * cards left and points.
	 */
	let {
		game,
		result,
		events,
		nameOf
	}: {
		game: string;
		result: Record<string, unknown>;
		/** The round's moves: Cloudburst shows the card the winner went out on. */
		events: { type: string; seat?: number; data?: Record<string, unknown> }[];
		nameOf: (seat: number) => string | null;
	} = $props();

	const BY: Record<string, string> = {
		player: 'played by the player',
		bot: 'played by a bot',
		timeout: 'played on timeout',
		away: 'played while away'
	};

	const livesWord = (lives: unknown) => {
		const count = Number(lives);
		return `${count} ${count === 1 ? 'life' : 'lives'}`;
	};

	/** Who made the busting move, in words; unknown values show a dash. */
	const byOf = (by: unknown) => {
		const key = String(by);
		return Object.hasOwn(BY, key) ? BY[key] : 'played';
	};

	const name = (seat: unknown) => {
		const index = Number(seat);
		return nameOf(index) ?? `Seat ${index + 1}`;
	};

	const bust = $derived(game === 'bust-31' && result.seat !== undefined ? result : null);
	const card = $derived(bust ? cardFace(game, String(bust.card)) : null);

	const tone = $derived.by(() => {
		if (bust) {
			return 'border-ember/40 bg-ember/[0.06]';
		}

		return standings ? 'border-brass/40 bg-brass/[0.06]' : 'border-paper/10';
	});

	/** Cloudburst: the last card the winner played, which emptied their hand. */
	const lastCard = $derived.by(() => {
		if (game !== 'cloudburst' || result.out === undefined) {
			return null;
		}

		const out = Number(result.out);
		const played = events.filter((event) => event.type === 'play' && event.seat === out).at(-1);

		return played?.data?.card ? cardFace(game, String(played.data.card)) : null;
	});

	/** Cloudburst: every seat with the cards it was left with this round and its points so far, fewest first. */
	const standings = $derived.by(() => {
		if (game !== 'cloudburst' || result.out === undefined) {
			return null;
		}

		const left = (result.left ?? {}) as Record<string, number>;
		const points = (result.points ?? {}) as Record<string, number>;
		const seats = Object.keys(points);

		return seats
			.map((seat) => ({ seat, left: left[seat] ?? 0, points: points[seat] ?? 0 }))
			.sort((a, b) => a.points - b.points);
	});
</script>

<div class="rounded-lg border p-4 {tone}">
	{#if bust && card}
		<div class="flex items-center gap-4">
			<span
				class="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-paper font-display text-2xl font-black shadow-chip {card.ink}"
				aria-label="Card, {card.spoken}"
			>
				{card.mark}
			</span>
			<div class="min-w-0">
				<p class="font-display text-lg font-bold text-paper">{name(bust.seat)} busted</p>
				<p class="text-xs text-paper/65">
					Played a {card.mark} for {String(bust.total)}, over the limit of {LIMIT}.
					{bust.eliminated
						? `${name(bust.seat)} is out of the match.`
						: `${name(bust.seat)} keeps ${livesWord(bust.lives)}.`}
					<span class="text-paper/45">({byOf(bust.by)})</span>
				</p>
			</div>
		</div>
	{:else if standings}
		<div class="flex items-center gap-4">
			{#if lastCard}
				<span
					class="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-paper font-display text-2xl font-black shadow-chip {lastCard.ink}"
					aria-label="Card, {lastCard.spoken}"
				>
					{lastCard.mark}
				</span>
			{/if}
			<div class="min-w-0">
				<p class="font-display text-lg font-bold text-paper">{name(result.out)} went out first</p>
				<p class="text-xs text-paper/65">
					Everyone else takes a point per card left; fewest points wins at {BURST_AT}.
				</p>
			</div>
		</div>
		<table class="mt-4 w-full text-left text-xs">
			<thead class="text-paper/55">
				<tr>
					<th class="py-1 font-medium">Player</th>
					<th class="py-1 text-right font-medium">Cards left</th>
					<th class="py-1 text-right font-medium">Points</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-paper/10">
				{#each standings as row (row.seat)}
					<tr>
						<td class="py-1.5 text-paper">{name(row.seat)}</td>
						<td class="py-1.5 text-right">{row.left}</td>
						<td class="py-1.5 text-right font-semibold text-paper">{row.points}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="text-paper/65">No result was recorded for this round.</p>
	{/if}
</div>
