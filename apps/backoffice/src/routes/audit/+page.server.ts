import { AUDIT_ACTIONS } from '#lib/audit-actions.ts';
import { auditAdmins, type AuditFilter, listAudit } from '#lib/server/audit-log.ts';
import { sql } from '#lib/server/db.ts';
import { PAGE_SIZE } from '#lib/server/players.ts';
import type { PageServerLoad } from './$types';

const MAX_PARAM_LENGTH = 64;

export const load: PageServerLoad = async ({ url }) => {
	const get = (key: string) => (url.searchParams.get(key) ?? '').trim().slice(0, MAX_PARAM_LENGTH);

	const action = get('action');
	const filter: AuditFilter = {
		admin: get('admin'),
		action: Object.hasOwn(AUDIT_ACTIONS, action) ? action : '',
		player: get('player'),
		from: get('from'),
		to: get('to'),
		before: get('before')
	};

	const [rows, admins] = await Promise.all([listAudit(sql, filter), auditAdmins(sql)]);
	const fullPage = rows.length === PAGE_SIZE;

	return {
		filter,
		admins,
		rows,
		next: fullPage ? rows.at(-1)!.id : null
	};
};
