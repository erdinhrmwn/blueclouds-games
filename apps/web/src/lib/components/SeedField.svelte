<script lang="ts">
  import Icon from '#lib/components/Icon.svelte'
  /** A seed shown in full with a copy button: the Fair play dialog and a match's history page. */
  let { id, label, value }: { id: string; label: string; value: string } = $props()

  /** How long the button shows its "copied" tick. */
  const COPIED_MS = 1500

  let copied = $state(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // The browser blocked the clipboard: select the text so it can be copied by hand.
      const box = document.getElementById(id)
      if (box) {
        window.getSelection()?.selectAllChildren(box)
      }

      return
    }

    copied = true
    setTimeout(() => {
      copied = false
    }, COPIED_MS)
  }
</script>

<div>
  <p class="label mb-1.5" id="{id}-label">{label}</p>
  <div class="flex items-stretch gap-2">
    <output
      {id}
      aria-labelledby="{id}-label"
      class="min-w-0 flex-1 rounded-lg border border-paper/10 bg-black/30 px-3 py-2 font-mono text-xs break-all text-paper"
    >
      {value}
    </output>
    <button
      class="btn-ghost size-10 shrink-0 p-0"
      onclick={copy}
      aria-label="Copy {label.toLowerCase()}"
      title="Copy"
    >
      {#if copied}
        <Icon name="check" class="size-4 text-brass" />
      {:else}
        <Icon name="copy" class="size-4" />
      {/if}
    </button>
  </div>
  <p class="sr-only" aria-live="polite">{copied ? 'Copied.' : ''}</p>
</div>
