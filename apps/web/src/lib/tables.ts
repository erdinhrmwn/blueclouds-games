import { goto } from '$app/navigation';
import { isRoomCode } from '#lib/guest.ts';
import { openRoom } from '#lib/platform.ts';

/** Opens a game's table by code. Returns an error to show, or null when it went there. */
export function enterTable(game: string, code: string): string | null {
	if (!isRoomCode(code)) return 'A table code is 4–8 letters or digits.';
	goto(`/${game}/room/${code}`);
	return null;
}

/** Opens a new table (the platform picks its code) and goes there. Returns an error to show, or null. */
export async function newTable(game: string): Promise<string | null> {
	try {
		const { code } = await openRoom(game);
		await goto(`/${game}/room/${code}`);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : 'Something went wrong. Try again.';
	}
}
