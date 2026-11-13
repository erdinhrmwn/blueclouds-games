<script lang="ts">
	import './layout.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	type NavItem = { href: string; label: string; icon: IconName; ownerOnly?: boolean };
	type NavGroup = { label: string | null; items: NavItem[] };

	const NAV: NavGroup[] = [
		{
			label: null,
			items: [{ href: '/', label: 'Overview', icon: 'overview' }]
		},
		{
			label: 'Operations',
			items: [
				{ href: '/players', label: 'Players', icon: 'players' },
				{ href: '/matches', label: 'Matches', icon: 'matches' },
				{ href: '/live', label: 'Live tables', icon: 'live' },
				{ href: '/tournaments', label: 'Tournaments', icon: 'tournaments' }
			]
		},
		{
			label: 'System',
			items: [
				{ href: '/admins', label: 'Admins', icon: 'admins', ownerOnly: true },
				{ href: '/audit', label: 'Audit log', icon: 'audit' }
			]
		}
	];

	/** The groups this admin may open: owner-only links are dropped for everyone else. */
	const nav = $derived.by(() => {
		const owner = data.admin?.role === 'owner';
		const groups = NAV.map((group) => ({
			...group,
			items: group.items.filter((item) => owner || !item.ownerOnly)
		}));

		return groups.filter((group) => group.items.length > 0);
	});

	const current = (href: string) => {
		const path = page.url.pathname;
		if (href === '/') return path === '/';

		return path === href || path.startsWith(href + '/');
	};

	/** The players page has its own search; everywhere else the top bar offers one. */
	const showTopSearch = $derived(!current('/players'));

	let drawer = $state<HTMLDialogElement>();

	afterNavigate(() => {
		drawer?.close();
	});

	/** A click on the dimmed backdrop lands on the <dialog> itself, not on its content. */
	const closeOnBackdrop = (event: MouseEvent) => {
		if (event.target === drawer) {
			drawer.close();
		}
	};
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap"
	/>
</svelte:head>

{#snippet sidebar()}
	<div class="flex h-full flex-col">
		<a href="/" class="flex min-h-16 items-center gap-3 px-5">
			<span
				class="grid size-8 place-items-center rounded-lg bg-white/10 text-sm font-semibold tracking-wide"
				aria-hidden="true">BC</span
			>
			<span class="leading-tight">
				<span class="block font-semibold">BlueClouds</span>
				<span class="block text-xs text-white/60">Backoffice</span>
			</span>
		</a>

		<nav aria-label="Main" class="mt-4 flex-1 space-y-6 overflow-y-auto px-3">
			{#each nav as group (group.label)}
				<div>
					{#if group.label}
						<p
							class="mb-1.5 px-3 text-[0.6875rem] font-semibold tracking-wider text-white/45 uppercase"
						>
							{group.label}
						</p>
					{/if}
					<ul class="space-y-1">
						{#each group.items as item (item.href)}
							<li>
								<a
									href={item.href}
									aria-current={current(item.href) ? 'page' : undefined}
									class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white aria-[current=page]:bg-white/10 aria-[current=page]:text-white"
								>
									<Icon name={item.icon} />
									{item.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>

		<p class="px-5 py-5 text-xs text-white/50">All times are UTC.</p>
	</div>
{/snippet}

{#if data.admin}
	<div class="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
		<aside class="hidden bg-felt-deep text-white lg:block">
			<div class="sticky top-0 h-dvh">
				{@render sidebar()}
			</div>
		</aside>

		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<dialog
			bind:this={drawer}
			aria-label="Menu"
			class="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-felt-deep text-white backdrop:bg-ink/50 lg:hidden"
			onclick={closeOnBackdrop}
		>
			<button
				class="absolute top-3 right-3 grid size-11 place-items-center rounded-lg text-white/70 hover:bg-white/5 hover:text-white"
				aria-label="Close menu"
				onclick={() => drawer?.close()}
			>
				<Icon name="close" />
			</button>
			{@render sidebar()}
		</dialog>

		<div class="flex min-h-dvh min-w-0 flex-col">
			<header class="sticky top-0 z-10 border-b border-line bg-surface">
				<div class="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
					<button
						class="-ml-2 grid size-11 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink lg:hidden"
						aria-label="Open menu"
						onclick={() => drawer?.showModal()}
					>
						<Icon name="menu" />
					</button>
					<a href="/" class="font-semibold lg:hidden">Backoffice</a>

					{#if showTopSearch}
						<form
							method="GET"
							action="/players"
							role="search"
							class="relative hidden w-full max-w-sm sm:block"
						>
							<label class="sr-only" for="top-search">Find a player</label>
							<span
								class="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted"
							>
								<Icon name="search" class="size-4" />
							</span>
							<input
								id="top-search"
								name="q"
								maxlength="64"
								placeholder="Find a player by name, username or id"
								class="field min-h-10 bg-subtle pl-9 text-sm"
							/>
						</form>
					{/if}

					<div class="ml-auto flex items-center gap-2">
						<a
							href="/account"
							class="flex min-h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-subtle sm:pr-3"
							aria-current={current('/account') ? 'page' : undefined}
							title="Your account"
						>
							<span
								class="grid size-9 place-items-center rounded-full bg-felt-soft text-sm font-semibold text-felt uppercase"
								aria-hidden="true">{data.admin.username.slice(0, 1)}</span
							>
							<span class="sr-only sm:not-sr-only sm:block sm:text-sm sm:leading-tight">
								<span class="sr-only">Your account, signed in as</span>
								<span class="block font-medium">{data.admin.username}</span>
								<span class="block text-xs text-muted capitalize">{data.admin.role}</span>
							</span>
						</a>
						<form method="POST" action="/logout" class="ml-1">
							<button
								class="grid size-11 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
								aria-label="Sign out"
								title="Sign out"
							>
								<Icon name="signOut" />
							</button>
						</form>
					</div>
				</div>
			</header>

			<main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	<main class="px-4">
		{@render children()}
	</main>
{/if}
