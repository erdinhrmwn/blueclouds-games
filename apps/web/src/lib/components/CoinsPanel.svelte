<script lang="ts">
	import { type CoinChange, fetchCoins } from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { when } from '#lib/when.ts';

	/** The profile's coins: the balance, then every change with its reason, newest first. */
	let history = $state<CoinChange[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		void load();
	});

	async function load() {
		try {
			const coins = await fetchCoins();
			player.coins = coins.balance;
			history = coins.history;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load your coins.';
		} finally {
			loading = false;
		}
	}

	/** "Fee · Night Owls", "Refund · Friday Cup (cancelled)", "Added by the team · launch gift". */
	function label(change: CoinChange): string {
		const name = change.tournament?.name ?? '';
		const cancelled = change.tournament?.cancelled ? ' (cancelled)' : '';

		switch (change.reason) {
			case 'signup_bonus':
				return 'Account bonus';
			case 'admin_grant':
				return `Added by the team · ${change.note ?? ''}`;
			case 'admin_take':
				return `Taken by the team · ${change.note ?? ''}`;
			case 'tournament_fee':
				return `Fee · ${name}`;
			case 'tournament_refund':
				return `Refund · ${name}${cancelled}`;
			case 'tournament_prize':
				return `Prize · ${name}`;
		}
	}

	const signed = (amount: number) =>
		`${amount > 0 ? '+' : '−'}${Math.abs(amount).toLocaleString()}`;
</script>

<section class="mt-12" aria-labelledby="coins-title">
	<h2 id="coins-title" class="font-display text-xl font-bold">Coins</h2>
	<div class="mt-4 rounded-2xl border border-paper/10 bg-panel p-5">
		<p class="flex items-center gap-3">
			<span class="coin size-7 shrink-0 rounded-full" aria-hidden="true"></span>
			<span class="font-display text-3xl font-black text-brass tabular-nums"
				>{player.coins.toLocaleString()}</span
			>
		</p>
		<p class="mt-2 text-sm text-paper/55">
			Virtual coins for tournament fees and prizes. They can’t be bought or cashed out.
		</p>

		{#if loading}
			<p class="mt-4 text-sm text-paper/60" aria-live="polite">Loading…</p>
		{:else if error}
			<p class="mt-4 text-sm text-ember" role="alert">{error}</p>
		{:else if history.length === 0}
			<p class="mt-4 text-sm text-paper/60">No coins have moved yet.</p>
		{:else}
			<ul class="mt-4 divide-y divide-paper/8 border-t border-paper/8">
				{#each history as change (change.id)}
					<li class="flex items-center justify-between gap-4 py-3">
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold">{label(change)}</span>
							<span class="text-xs text-paper/50">{when(change.at)}</span>
						</span>
						<span
							class="shrink-0 text-sm font-extrabold tabular-nums {change.amount > 0
								? 'text-go'
								: 'text-paper'}">{signed(change.amount)}</span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	/* A brass coin: the mark beside every balance. */
	.coin {
		background: radial-gradient(
			circle at 35% 30%,
			var(--color-brass) 0 55%,
			var(--color-brass-dim) 100%
		);
		box-shadow: inset 0 0 0 2px rgb(34 28 22 / 0.35);
	}
</style>
