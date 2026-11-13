<script lang="ts">
	/**
	 * How full a tournament is: "5 / 24 players", what it still needs to run (or that you're in), and a bar with a
	 * notch at the minimum: below it when sign-up closes, the tournament is cancelled.
	 */
	let {
		registered,
		minPlayers,
		maxPlayers,
		joined,
		full
	}: {
		registered: number;
		minPlayers: number | null;
		maxPlayers: number | null;
		joined: boolean;
		/** Sign-up closed because it filled up: the bar turns ember. */
		full: boolean;
	} = $props();

	const missing = $derived(minPlayers === null ? 0 : Math.max(minPlayers - registered, 0));

	/** Where `count` players sit on the bar, 0-100. */
	function percent(count: number): number {
		if (!maxPlayers) {
			return 0;
		}

		return Math.min(count / maxPlayers, 1) * 100;
	}
</script>

<p class="flex justify-between gap-3 text-xs text-paper/55 tabular-nums">
	<span>
		<span class="font-semibold text-paper/85">{registered}</span>
		{#if maxPlayers !== null}/ {maxPlayers}{/if}
		players
	</span>
	{#if missing > 0}
		<span>needs {missing} more</span>
	{:else if joined}
		<span class="font-semibold text-brass">you’re in</span>
	{/if}
</p>
{#if maxPlayers !== null}
	<div class="relative mt-2 h-1.5 rounded-full bg-paper/12" aria-hidden="true">
		<div
			class="h-full rounded-full {full ? 'bg-ember' : 'bg-brass'}"
			style="width: {percent(registered)}%"
		></div>
		{#if minPlayers !== null}
			<span
				class="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-paper/60"
				style="left: {percent(minPlayers)}%"
			></span>
		{/if}
	</div>
{/if}
