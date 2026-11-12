import { listAudit } from '#lib/server/audit-log.ts';
import { sql } from '#lib/server/db.ts';
import { PAGE_SIZE } from '#lib/server/players.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const before = url.searchParams.get('before');
	const rows = await listAudit(sql, before);
	const fullPage = rows.length === PAGE_SIZE;

	return {
		rows,
		paged: !!before,
		next: fullPage ? rows.at(-1)!.id : null
	};
};
