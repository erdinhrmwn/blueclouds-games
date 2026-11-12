import { goto } from '$app/navigation';
import { isInviteCode, isRoomCode } from '#lib/guest.ts';
import { openRoom, redeemInviteCode, type Visibility } from '#lib/platform.ts';

const problem = (e: unknown) =>
	e instanceof Error ? e.message : 'Something went wrong. Try again.';

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
	} catch (e) {
		return problem(e);
	}
}

/** Redeems an invite code from a friend and goes to its table. Returns an error to show, or null. */
export async function joinWithInvite(input: string): Promise<string | null> {
	const code = input.trim().toUpperCase();
	if (!isInviteCode(code)) return 'An invite code is 6 letters or digits.';
	try {
		const room = await redeemInviteCode(code);
		await goto(`/${room.game}/room/${room.code}`);
		return null;
	} catch (e) {
		return problem(e);
	}
}
