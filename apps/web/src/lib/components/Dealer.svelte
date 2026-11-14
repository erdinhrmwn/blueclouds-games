<script lang="ts">
	import Nimbus from './Nimbus.svelte';

	/** The dealer's spot at the head of the table: Nimbus in a brass-ringed pit cut into the rail, and its name plate. */
</script>

<div class="relative flex flex-col items-center" aria-label="Dealer Nimbus" role="img">
	<div
		class="pit grid size-[4.25rem] place-items-center rounded-full wide:size-[5.25rem]"
		aria-hidden="true"
	>
		<Nimbus class="size-12 wide:size-[3.75rem]" />
	</div>
	<p
		class="-mt-2 rounded-[4px] bg-brass px-2 py-px font-display text-[10px] font-bold text-ink wide:text-[11px]"
		aria-hidden="true"
	>
		Nimbus
	</p>
</div>

<style>
	.pit {
		background: radial-gradient(circle at 50% 40%, #241b14, #14110e 70%);
		box-shadow:
			0 0 0 2px var(--color-brass),
			0 0 0 6px var(--color-room),
			0 8px 18px rgb(0 0 0 / 0.5);
	}
</style>
