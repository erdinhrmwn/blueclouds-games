import { error, fail } from '@sveltejs/kit';
import {
	addAdmin,
	changeRole,
	disableAdmin,
	enableAdmin,
	isAdminRole,
	isOwner,
	listAdmins,
	resetAdminPassword
} from '#lib/server/admins.ts';
import { type Admin, auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

/** Only owners manage admins; everyone else gets a 403, in the page and in every action. */
function requireOwner(admin: Admin | null): Admin {
	if (!admin || !isOwner(admin)) {
		error(403, 'Only an owner can manage admins.');
	}

	return admin;
}

/** The admin a form is about, from its hidden `id` field. */
async function targetId(request: Request): Promise<string> {
	const form = await request.formData();

	return String(form.get('id') ?? '');
}

export const load: PageServerLoad = async ({ locals }) => {
	const owner = requireOwner(locals.admin);
	const admins = await listAdmins(sql);

	return { admins, ownerId: owner.id };
};

export const actions: Actions = {
	add: async ({ request, locals, getClientAddress }) => {
		const owner = requireOwner(locals.admin);
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const role = String(form.get('role') ?? '');
		if (!isAdminRole(role)) {
			return fail(400, { username, error: 'Pick a role.' });
		}

		const input = { username, role };
		const result = await addAdmin(sql, owner, input, auditIp(getClientAddress()));
		if (!result.ok && result.reason === 'invalid') {
			return fail(400, { username, error: 'Use 3-32 characters: a-z, 0-9, _ . - (not root).' });
		}
		if (!result.ok) {
			return fail(409, { username, error: `There is already an admin called ${username}.` });
		}

		return { username: username.trim().toLowerCase(), password: result.password };
	},
	disable: async ({ request, locals, getClientAddress }) => {
		const owner = requireOwner(locals.admin);
		const id = await targetId(request);

		const done = await disableAdmin(sql, owner, id, auditIp(getClientAddress()));
		if (!done) return fail(409, { error: 'That admin is already disabled, or cannot be.' });

		return { message: 'Admin disabled and signed out everywhere.' };
	},
	changeRole: async ({ request, locals, getClientAddress }) => {
		const owner = requireOwner(locals.admin);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const role = String(form.get('role') ?? '');
		if (!isAdminRole(role)) {
			return fail(400, { error: 'Pick a role.' });
		}

		const done = await changeRole(sql, owner, id, role, auditIp(getClientAddress()));
		if (!done) return fail(409, { error: 'That role cannot be changed.' });

		return { message: 'Role changed.' };
	},
	enable: async ({ request, locals, getClientAddress }) => {
		const owner = requireOwner(locals.admin);
		const id = await targetId(request);

		const done = await enableAdmin(sql, owner, id, auditIp(getClientAddress()));
		if (!done) return fail(409, { error: 'That admin is already enabled.' });

		return { message: 'Admin enabled. They sign in with their old password.' };
	},
	resetPassword: async ({ request, locals, getClientAddress }) => {
		const owner = requireOwner(locals.admin);
		const id = await targetId(request);

		const password = await resetAdminPassword(sql, owner, id, auditIp(getClientAddress()));
		if (!password) {
			return fail(409, { error: 'Root and your own password can only be changed on the server.' });
		}

		const [admin] = (await listAdmins(sql)).filter((row) => row.id === id);

		return { username: admin?.username ?? '', password };
	}
};
