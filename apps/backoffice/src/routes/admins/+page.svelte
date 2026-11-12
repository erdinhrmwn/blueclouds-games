<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
	let copied = $state(false);

	const ROOT = 'root';
	/** The same rule as the server's USERNAME, checked in the browser first; any case, it is lowercased. */
	const USERNAME_PATTERN = '[a-zA-Z0-9_.\\-]{3,32}';
	const ROLES = [
		{ value: 'owner', label: 'Owner', note: 'Manages admins, and everything an admin does.' },
		{ value: 'admin', label: 'Admin', note: 'Players, VIP, tournaments and tables.' },
		{ value: 'viewer', label: 'Viewer', note: 'Sees everything, changes nothing.' }
	];
	const roleLabel = (role: string) => ROLES.find((option) => option.value === role)?.label ?? role;

	const submit = () => {
		busy = true;
		copied = false;

		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: true });
			busy = false;
		};
	};

	const copyPassword = async (password: string) => {
		await navigator.clipboard.writeText(password);
		copied = true;
	};
</script>

<svelte:head><title>Admins · Backoffice</title></svelte:head>

<PageHeader
	title="Admins"
	description="Who can sign in to the backoffice and what they may do. Only owners see this page."
/>

{#if form && 'password' in form && form.password}
	<section
		class="panel mb-6 border-felt/30 bg-felt-soft px-5 py-4 text-felt"
		aria-labelledby="new-password"
		role="status"
	>
		<h2 id="new-password" class="font-semibold">Password for {form.username}</h2>
		<p class="mt-1 text-sm">
			Copy it now and hand it over privately. It is not shown again; reset it if it gets lost.
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<code class="rounded-md border border-felt/20 bg-surface px-3 py-2 font-mono text-sm text-ink"
				>{form.password}</code
			>
			<button class="btn-quiet" type="button" onclick={() => copyPassword(form.password)}
				>{copied ? 'Copied' : 'Copy'}</button
			>
		</div>
	</section>
{/if}
{#if form && 'message' in form && form.message}
	<p class="panel mb-6 border-felt/30 bg-felt-soft px-4 py-3 text-sm text-felt" role="status">
		{form.message}
	</p>
{/if}
{#if form && 'error' in form && form.error}
	<p class="panel mb-6 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
		{form.error}
	</p>
{/if}

<div class="grid gap-6 xl:grid-cols-3 xl:items-start">
	<section class="panel min-w-0 xl:col-span-2" aria-labelledby="list">
		<div class="panel-head">
			<h2 id="list" class="font-semibold">All admins</h2>
		</div>
		<div class="overflow-x-auto">
			<table class="data-table min-w-[56rem]">
				<thead>
					<tr>
						<th>Username</th>
						<th>Role</th>
						<th>Status</th>
						<th>Last sign-in</th>
						<th>Sessions</th>
						<th><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.admins as admin (admin.id)}
						{@const fixed = admin.username === ROOT || admin.id === data.ownerId}
						<tr>
							<td class="whitespace-nowrap">
								<span class="font-medium">{admin.username}</span>
								{#if admin.id === data.ownerId}<span class="tag ml-1.5">You</span>{/if}
							</td>
							<td>
								{#if fixed}
									{roleLabel(admin.role)}
								{:else}
									<form
										method="POST"
										action="?/changeRole"
										class="flex items-center gap-2"
										use:enhance={submit}
									>
										<input type="hidden" name="id" value={admin.id} />
										<label class="sr-only" for="role-{admin.id}">Role of {admin.username}</label>
										<select
											class="field min-h-9 w-auto py-0 pr-8 text-sm"
											id="role-{admin.id}"
											name="role"
											value={admin.role}
										>
											{#each ROLES as option (option.value)}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
										<button class="btn-quiet min-h-9 px-3" disabled={busy}>Save</button>
									</form>
								{/if}
							</td>
							<td>
								{#if admin.disabledAt}
									<span class="tag-bad">Disabled</span>
								{:else}
									<span class="tag-good">Active</span>
								{/if}
							</td>
							<td class="whitespace-nowrap">
								{admin.lastSignInAt ? utc(admin.lastSignInAt) : 'Never'}
							</td>
							<td class="tabular-nums">{admin.sessions}</td>
							<td>
								{#if !fixed}
									<div class="flex justify-end gap-2">
										<form method="POST" action="?/resetPassword" use:enhance={submit}>
											<input type="hidden" name="id" value={admin.id} />
											<button
												class="btn-quiet min-h-9 px-3"
												disabled={busy}
												aria-label="Reset the password of {admin.username}">Reset password</button
											>
										</form>
										{#if admin.disabledAt}
											<form method="POST" action="?/enable" use:enhance={submit}>
												<input type="hidden" name="id" value={admin.id} />
												<button
													class="btn-quiet min-h-9 px-3"
													disabled={busy}
													aria-label="Enable {admin.username}">Enable</button
												>
											</form>
										{:else}
											<form
												method="POST"
												action="?/disable"
												use:enhance={({ cancel }) => {
													if (
														!confirm(`Disable ${admin.username}? They are signed out everywhere.`)
													) {
														return cancel();
													}

													return submit();
												}}
											>
												<input type="hidden" name="id" value={admin.id} />
												<button
													class="btn-quiet min-h-9 px-3 text-danger"
													disabled={busy}
													aria-label="Disable {admin.username}">Disable</button
												>
											</form>
										{/if}
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="panel" aria-labelledby="add">
		<div class="panel-head">
			<div>
				<h2 id="add" class="font-semibold">Add admin</h2>
				<p class="text-sm text-muted">A password is made for them and shown to you once.</p>
			</div>
		</div>
		<form method="POST" action="?/add" class="space-y-4 px-5 py-5" use:enhance={submit}>
			<div>
				<label class="label" for="username">Username</label>
				<input
					class="field"
					id="username"
					name="username"
					value={form && 'username' in form && !('password' in form) ? form.username : ''}
					autocomplete="off"
					autocapitalize="none"
					maxlength="32"
					pattern={USERNAME_PATTERN}
					required
				/>
				<p class="mt-1.5 text-xs text-muted">3-32 characters: a-z, 0-9, _ . -</p>
			</div>
			<fieldset>
				<legend class="label">Role</legend>
				<div class="space-y-2">
					{#each ROLES as option (option.value)}
						<label
							class="flex cursor-pointer gap-3 rounded-lg border border-line px-3 py-2.5 has-checked:border-felt has-checked:bg-felt-soft"
						>
							<input
								class="mt-1 accent-felt"
								type="radio"
								name="role"
								value={option.value}
								checked={option.value === 'admin'}
							/>
							<span class="text-sm">
								<span class="block font-medium">{option.label}</span>
								<span class="block text-muted">{option.note}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<button class="btn-primary w-full" disabled={busy}>Add admin</button>
		</form>
	</section>
</div>
