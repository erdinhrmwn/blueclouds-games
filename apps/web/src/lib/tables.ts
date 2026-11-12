import { goto } from '$app/navigation';
import { isRoomCode } from '#lib/guest.ts';
import { openRoom, type Visibility } from '#lib/platform.ts';

const problem = (err: unknown) =>
	err instanceof Error ? err.message : 'Something went wrong. Try again.';

/** Opens a listed table by its code. Returns an error to show, or null when it went there. */
export function enterTable(game: string, code: string): string | null {
	if (!isRoomCode(code)) return 'A table code is 4–8 letters or digits.';

	goto(`/${game}/room/${code}`);
	return null;
}

/** Opens a new table (the platform picks its code) and goes there. Returns an error to show, or null. */
export async function newTable(game: string, visibility: Visibility): Promise<string | null> {
	try {
		const { code } = await openRoom(game, visibility);
		await goto(`/${game}/room/${code}`);
		return null;
	} catch (err) {
		return problem(err);
	}
}
