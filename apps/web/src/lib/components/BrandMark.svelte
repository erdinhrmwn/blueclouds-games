<script lang="ts">
  /**
   * The BlueClouds Games mark: Nimbus in a brass seal (FigCraft page "Brand · Logo"). `small` is the
   * 32px-and-under drawing: one thick ring and a bolder face, so it still reads in a header or a tab.
   * The head is Nimbus.svelte's, without the bow tie.
   */
  let { small = false, class: cls = 'size-6' }: { small?: boolean; class?: string } = $props()
</script>

<svg viewBox="-50 -50 100 100" class={cls} aria-hidden="true">
  <circle r="50" fill="#1f3f5f" />
  {#if small}
    <circle r="45.5" fill="none" stroke="var(--color-brass)" stroke-width="9" />
  {:else}
    <circle r="46.5" fill="none" stroke="var(--color-brass)" stroke-width="4" />
    <circle r="40" fill="none" stroke="var(--color-brass-dim)" stroke-width="1.2" />
  {/if}
  <g transform={small ? 'translate(-1 7) scale(1.37)' : 'translate(-1 6) scale(1.22)'}>
    <circle cx="-14" cy="3" r="13" fill="#b7d2ec" />
    <circle cx="1" cy="-6" r="17" fill="#b7d2ec" />
    <circle cx="16" cy="4" r="12" fill="#b7d2ec" />
    <rect x="-27" y="0" width="54" height="19" rx="9.5" fill="#b7d2ec" />
    <path d="M-17 -12 Q1 -24 19 -12 L23 -7 Q1 -15 -21 -7 Z" fill="#2f6e4f" fill-opacity="0.92" />
    <path
      d="M-21 -7 Q1 -15 23 -7"
      fill="none"
      stroke="var(--color-brass)"
      stroke-width={small ? 2.6 : 1.6}
      stroke-linecap="round"
    />
    <path
      d="M-9 4 q3 -3 6 0 M5 4 q3 -3 6 0"
      fill="none"
      stroke="var(--color-ink)"
      stroke-width={small ? 3.2 : 1.9}
      stroke-linecap="round"
    />
    {#if small}
      <path
        d="M-2.5 10 q3.5 3 7 0"
        fill="none"
        stroke="var(--color-ink)"
        stroke-width="2.8"
        stroke-linecap="round"
      />
    {:else}
      <circle cx="-12" cy="9" r="2.4" fill="#e79a8a" fill-opacity="0.55" />
      <circle cx="14" cy="9" r="2.4" fill="#e79a8a" fill-opacity="0.55" />
      <path
        d="M-2 9 q3 2.6 6 0"
        fill="none"
        stroke="var(--color-ink)"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    {/if}
  </g>
</svg>
