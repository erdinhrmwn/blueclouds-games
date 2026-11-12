/** Dates in the backoffice are shown in UTC, the same as the database and the logs. */
export function utc(date: Date | string | null): string {
	if (!date) return '';

	// "2026-11-12T06:12:04.000Z" → "2026-11-12 06:12 UTC"
	const minutes = new Date(date).toISOString().slice(0, 16);
	return `${minutes.replace('T', ' ')} UTC`;
}

/** A player's type: a bot is run by the system; anyone else is a VIP or a normal player. */
export function playerType(player: { isBot: boolean; isVip: boolean }): 'Bot' | 'VIP' | 'Normal' {
	if (player.isBot) return 'Bot';
	if (player.isVip) return 'VIP';

	return 'Normal';
}

/** The pill style for each player type, the same on the list and the detail page. */
export const PLAYER_TYPE_TAG = {
	Normal: 'tag',
	VIP: 'tag-vip',
	Bot: 'tag bg-subtle text-muted'
} as const;
