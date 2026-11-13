import { underMaintenance } from '#lib/server/platform.ts';
import type { PageServerLoad } from './$types';

/** Whether the game is paused for maintenance: its page then opens no new tables. */
export const load: PageServerLoad = async (event) => {
	return { maintenance: await underMaintenance(event, event.params.game) };
};
