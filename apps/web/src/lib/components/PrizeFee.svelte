<script lang="ts">
	/** What you can win and what it costs to sit down, side by side, as the admin wrote them. */
	let { prize, fee }: { prize: string | null; fee: number } = $props();

	const feeText = $derived(fee === 0 ? 'Free' : `${fee.toLocaleString()} coins`);
</script>

<dl class="grid grid-cols-[3fr_2fr] gap-2">
	<div class="min-w-0 rounded-lg bg-black/30 px-3 py-2">
		<dt class="text-xs text-paper/50">Prize</dt>
		<dd class="truncate text-sm font-bold text-brass">{prize ?? '—'}</dd>
	</div>
	<div class="min-w-0 rounded-lg bg-black/30 px-3 py-2">
		<dt class="text-xs text-paper/50">Fee</dt>
		<dd class="truncate text-sm font-bold text-paper">{feeText}</dd>
	</div>
</dl>
