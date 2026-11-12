import { suggestGuestName } from '#lib/guest.ts';
import type { PageLoad } from './$types';

/** Picked in `load` so the server render and the browser show the same name. */
export const load: PageLoad = () => ({ guestName: suggestGuestName() });
