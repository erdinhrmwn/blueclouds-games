<script lang="ts">
  import Avatar from '#lib/components/Avatar.svelte'
  import Icon from '#lib/components/Icon.svelte'
  import { ask } from '#lib/confirm.svelte.ts'
  import { goto } from '$app/navigation'
  import { WELCOME } from '#lib/guest.ts'
  import { logOut, player } from '#lib/player.svelte.ts'

  /** The header's account menu: your name opens it, with Profile and Log out inside. */
  interface Props {
    onError: (message: string | null) => void
  }

  let { onError }: Props = $props()

  const GUEST_LOGOUT_WARNING = 'Guest names aren’t saved. Make an account to keep yours.'

  let open = $state(false)
  let root = $state<HTMLDivElement>()
  let trigger = $state<HTMLButtonElement>()
  let menu = $state<HTMLDivElement>()

  const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  function toggle() {
    open = !open
  }

  function close(refocus: boolean) {
    open = false
    if (refocus) {
      trigger?.focus()
    }
  }

  // The first item takes focus when the menu opens, so the keyboard can go straight on.
  $effect(() => {
    if (open) {
      items()[0]?.focus()
    }
  })

  // A click anywhere else closes it.
  $effect(() => {
    if (!open) {
      return
    }

    const outside = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) {
        close(false)
      }
    }

    document.addEventListener('pointerdown', outside)

    return () => document.removeEventListener('pointerdown', outside)
  })

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close(true)
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    all[(at + step + all.length) % all.length]?.focus()
  }

  async function signOut() {
    close(false)
    // A guest only exists in this browser: logging out loses it for good.
    if (player.guest) {
      const sure = await ask({
        title: 'Log out as a guest?',
        body: GUEST_LOGOUT_WARNING,
        action: 'Log out',
        keep: 'Keep playing',
      })
      if (!sure) {
        return
      }
    }

    const error = await logOut()
    onError(error)
    if (!error) {
      await goto(WELCOME, { invalidateAll: true })
    }
  }
</script>

<div class="relative min-w-0" bind:this={root}>
  <button
    bind:this={trigger}
    class="pill inline-flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full p-1 text-left text-sm leading-tight hover:bg-paper/5 sm:pr-3"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="account-menu"
    aria-label="Account: {player.name}{player.guest
      ? ', guest'
      : `, ${player.coins.toLocaleString()} coins`}"
    onclick={toggle}
    onkeydown={(event) => {
      if (event.key === 'ArrowDown' && !open) {
        event.preventDefault()
        open = true
      }
    }}
  >
    <!-- The pill hugs its content: the balance (accounts), the avatar always, and the name from tablet width up. -->
    {#if !player.guest}
      <span
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brass/16 pr-2.5 pl-1.5 text-[13px] font-extrabold text-brass tabular-nums"
      >
        <span class="coin size-4 rounded-full" aria-hidden="true"></span>
        {player.coins.toLocaleString()}
      </span>
    {/if}
    <Avatar
      id={player.id}
      name={player.name}
      avatar={player.avatar}
      class="size-8 rounded-full text-sm"
    />
    <span class="hidden max-w-32 min-w-0 truncate font-semibold sm:block" aria-hidden="true"
      >{player.name}</span
    >
    <Icon
      name="next"
      class="size-4 shrink-0 text-paper/70 transition-transform max-sm:hidden motion-reduce:transition-none {open
        ? '-rotate-90'
        : 'rotate-90'}"
    />
  </button>

  {#if open}
    <div
      bind:this={menu}
      id="account-menu"
      role="menu"
      tabindex="-1"
      aria-label="Account"
      class="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border border-paper/15 bg-panel py-1 shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
      onkeydown={onKeydown}
    >
      <a
        href="/profile"
        role="menuitem"
        class="flex min-h-11 items-center gap-2.5 px-3 text-sm hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
        onclick={() => close(false)}
      >
        <Icon name="player" class="size-4 text-paper/70" />
        Profile
      </a>
      <a
        href="/history"
        role="menuitem"
        class="flex min-h-11 items-center gap-2.5 px-3 text-sm hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
        onclick={() => close(false)}
      >
        <Icon name="history" class="size-4 text-paper/70" />
        Match history
      </a>
      <button
        role="menuitem"
        class="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
        onclick={signOut}
      >
        <Icon name="log out" class="size-4 text-paper/70" />
        Log out
      </button>
    </div>
  {/if}
</div>

<style>
  .coin {
    background: radial-gradient(
      circle at 35% 30%,
      var(--color-brass) 0 55%,
      var(--color-brass-dim) 100%
    );
    box-shadow: inset 0 0 0 1.5px rgb(34 28 22 / 0.35);
  }
  .pill {
    background: rgb(0 0 0 / 0.3);
    box-shadow: inset 0 0 0 1px rgb(243 234 214 / 0.16);
  }
</style>
