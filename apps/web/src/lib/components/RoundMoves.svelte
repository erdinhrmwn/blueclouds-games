<script lang="ts">
	import { cardFace, type RoundEvent } from '#lib/rounds.ts';

	/**
	 * Everything that happened in a closed round, from its move log: the hands dealt and every move after, with
	 * the time since the deal.
	 */
	let {
		game,
		events,
		nameOf
	}: {
		game: string;
		events: RoundEvent[];
		nameOf: (seat: number) => string | null;
	} = $props();

	/** `tone`: bad news (a bust) in ember, the round's winner (went out) in brass. */
	type Line = {
		seq: number;
		time: string;
		who: string | null;
		what: string;
		card: string | null;
		note: string;
		tone: 'plain' | 'bad' | 'good';
	};

	const TONE_TEXT = { plain: 'text-paper/80', bad: 'text-ember', good: 'text-brass' } as const;
	const NOTE_TEXT = { plain: 'text-paper/55', bad: 'text-ember', good: 'text-brass' } as const;

	const name = (seat: unknown) => {
		const index = Number(seat);
		return nameOf(index) ?? `Seat ${index + 1}`;
	};

	const deal = $derived(events.find((event) => event.type === 'deal') ?? null);
	const dealtAt = $derived(deal?.t ?? 0);
	/** Cloudburst turns one card face up to start the pile. */
	const pileStart = $derived(deal?.data?.start ? String(deal.data.start) : null);

	/** Each seat's hand at the deal, in seat order; the starter is marked. */
	const hands = $derived.by(() => {
		const dealt = (deal?.data?.hands ?? {}) as Record<string, string[]>;
		const starter = Number(deal?.data?.starter);

		return Object.entries(dealt)
			.map(([seat, cards]) => ({ seat: Number(seat), cards, starts: Number(seat) === starter }))
			.sort((a, b) => a.seat - b.seat);
	});

	const clock = (t: number) => {
		const seconds = Math.max(0, Math.round((t - dealtAt) / 1000));
		const minutes = Math.floor(seconds / 60);

		return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
	};

	/** Bust 31: the total after the card. Cloudburst: what the card did, or how many cards are left. */
	function playNote(data: Record<string, unknown>): string {
		if (game === 'bust-31') {
			return data.total === undefined ? '' : `total ${String(data.total)}`;
		}

		const kind = String(data.card).split('-').at(1);
		if (data.suit) {
			return `→ ${String(data.suit)}`;
		}

		if (data.gave !== undefined) {
			return 'gave a card';
		}

		if (kind === 'swirl') {
			return 'direction flips';
		}

		if (kind === 'calm') {
			return 'next is skipped';
		}

		return Number(data.left) === 0 ? 'last card' : `${String(data.left)} left`;
	}

	/** A move as one line: who, what, the card it moved and a short note. Null for events not worth a line. */
	function lineOf(event: RoundEvent): Line | null {
		const data = event.data ?? {};
		const who = event.seat === undefined ? null : name(event.seat);
		const base = {
			seq: event.seq,
			time: clock(event.t),
			who,
			card: null,
			note: '',
			tone: 'plain' as const
		};

		switch (event.type) {
			case 'play':
				return { ...base, what: 'played', card: String(data.card), note: playNote(data) };
			case 'draw':
				return { ...base, what: 'drew', card: data.card ? String(data.card) : null };
			case 'pass':
				return { ...base, what: 'passed' };
			case 'bust':
				return {
					...base,
					what: 'busted',
					card: String(data.card),
					note: `total ${String(data.total)}`,
					tone: 'bad'
				};
			case 'reshuffle':
				return {
					...base,
					what: 'Deck reshuffled',
					note: `${(data.deck as unknown[] | undefined)?.length ?? 0} cards`
				};
			case 'round_end':
				return { ...base, who: name(data.out), what: 'went out', note: 'round over', tone: 'good' };
			case 'away':
				return { ...base, what: 'left the table' };
			case 'back':
				return { ...base, what: 'came back' };
			case 'kicked':
				return { ...base, what: 'was removed', tone: 'bad' };
			case 'finished':
				return { ...base, what: 'Match over' };
			case 'terminated':
				return { ...base, what: 'Table stopped by an admin', tone: 'bad' };
			default:
				return null;
		}
	}

	const lines = $derived(events.map(lineOf).filter((line): line is Line => line !== null));
</script>

{#snippet chip(id: string)}
	{@const face = cardFace(game, id)}
	<span
		class="flex h-9 w-[1.625rem] shrink-0 items-center justify-center rounded bg-paper font-display text-[13px] font-black shadow-chip {face.ink}"
		aria-label={face.spoken}
	>
		{face.mark}
	</span>
{/snippet}

{#if hands.length}
	<section aria-labelledby="hands-title">
		<div class="flex items-center justify-between gap-3">
			<h3 id="hands-title" class="label">Hands dealt</h3>
			{#if pileStart}
				<span class="flex items-center gap-2 text-xs text-paper/55">
					Pile starts on {@render chip(pileStart)}
				</span>
			{/if}
		</div>
		<ul class="mt-2 space-y-2">
			{#each hands as hand (hand.seat)}
				<li class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
					<span class="w-24 shrink-0 truncate font-semibold text-paper">
						{name(hand.seat)}
						{#if hand.starts}<span class="ml-1 text-xs font-normal text-paper/55 sm:block sm:ml-0"
								>starts</span
							>{/if}
					</span>
					<span class="flex min-w-0 flex-wrap gap-1.5">
						{#each hand.cards as id (id)}
							{@render chip(id)}
						{/each}
					</span>
				</li>
			{/each}
		</ul>
		{#if game === 'cloudburst'}
			<p class="mt-2 text-xs text-paper/55">
				C Calm skips the next player, S Swirl flips direction, G Gust gives a card, ✦ Rainbow picks
				a suit.
			</p>
		{/if}
	</section>
{/if}

<section class="mt-6" aria-labelledby="moves-title">
	<h3 id="moves-title" class="label">Moves</h3>
	{#if lines.length === 0}
		<p class="mt-2 text-xs text-paper/55">No moves were logged in this round.</p>
	{:else}
		<ol class="mt-1 divide-y divide-paper/10">
			{#each lines as line (line.seq)}
				<li class="flex items-center gap-3 py-2">
					<span class="w-9 shrink-0 font-mono text-[11px] text-paper/45">{line.time}</span>
					<span class="min-w-0 flex-1 {TONE_TEXT[line.tone]}">
						{#if line.who}
							<b class="font-semibold {line.tone === 'plain' ? 'text-paper' : ''}">{line.who}</b>
						{/if}
						{line.what}
					</span>
					{#if line.card}
						{@render chip(line.card)}
					{:else}
						<span class="w-[1.625rem] shrink-0" aria-hidden="true"></span>
					{/if}
					<span class="w-24 shrink-0 text-right text-xs {NOTE_TEXT[line.tone]}">
						{line.note}
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</section>
