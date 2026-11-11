import { whoAmI } from '#lib/server/platform.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => ({ me: await whoAmI(event) });
