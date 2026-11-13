<script lang="ts">
	import type { TournamentPrize } from '#lib/platform.ts';
	import { coins } from '#lib/tournament-formats.ts';

	/** What you can win (the prize pool) and what it costs to sit down, side by side. */
	let { prizes, fee }: { prizes: TournamentPrize[]; fee: number } = $props();

	const pool = $derived(prizes.reduce((sum, prize) => sum + prize.coins, 0));

	/** The pool in coins; a tournament that pays only extras shows 1st place's, like a badge. */
	const prizeText = $derived.by(() => {
		if (pool > 0) {
			return coins(pool);
		}

		return prizes[0]?.extra ?? '—';
	});

	const feeText = $derived(fee === 0 ? 'Free' : coins(fee));
</script>

<dl class="grid grid-cols-[3fr_2fr] gap-2">
	<div class="min-w-0 rounded-lg bg-black/30 px-3 py-2">
		<dt class="text-xs text-paper/50">Prize pool</dt>
		<dd class="truncate text-sm font-bold text-brass">{prizeText}</dd>
	</div>
	<div class="min-w-0 rounded-lg bg-black/30 px-3 py-2">
		<dt class="text-xs text-paper/50">Fee</dt>
		<dd class="truncate text-sm font-bold text-paper">{feeText}</dd>
	</div>
</dl>
