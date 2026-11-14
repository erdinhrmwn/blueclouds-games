import type { AuditRow } from './server/audit-log.ts';

/** How each audit action reads in the backoffice. */
export const AUDIT_ACTIONS: Record<string, string> = {
	login: 'Signed in',
	login_failed: 'Failed sign-in',
	logout: 'Signed out',
	'player.disable': 'Disabled player',
	'player.enable': 'Enabled player',
	'player.vip_grant': 'Made player VIP',
	'player.vip_revoke': 'Took VIP away',
	'player.coins_adjust': 'Changed player coins',
	'tournament.create': 'Created tournament',
	'tournament.cancel': 'Cancelled tournament',
	'tournament.register': 'Registered players',
	'tournament.unregister': 'Unregistered player',
	'tournament.distribute': 'Handed out tables',
	'tournament.disqualify': 'Disqualified player',
	'tournament.payout': 'Paid out prizes',
	'room.assign': 'Seated player',
	'room.unassign': 'Took player off table',
	'room.kick': 'Kicked player from table',
	'room.terminate': 'Terminated table',
	'admin.create': 'Added admin',
	'admin.disable': 'Disabled admin',
	'admin.enable': 'Enabled admin',
	'admin.password_reset': 'Reset admin password',
	'admin.role_change': 'Changed admin role',
	'admin.password_change': 'Changed own password',
	'game.maintenance_start': 'Started game maintenance',
	'game.maintenance_end': 'Ended game maintenance'
};

/** Actions worth a second look, shown in the danger colour. */
const ALARMING = new Set([
	'login_failed',
	'player.disable',
	'admin.disable',
	'room.kick',
	'room.terminate'
]);

export const auditLabel = (action: string) => AUDIT_ACTIONS[action] ?? action;

export const isAlarming = (action: string) => ALARMING.has(action);

/** Who did it: the admin, or the platform for the automatic table hand-out. */
export function auditActor(row: AuditRow): string {
	if (row.admin) {
		return row.admin;
	}

	if (row.action === 'tournament.distribute') {
		return 'Platform';
	}

	return '';
}

/** The one detail worth showing per action. */
export function auditNote(row: AuditRow): string {
	const { action, detail } = row;

	if (action === 'login_failed') {
		return `as “${detail.username}”`;
	}

	if (action.startsWith('game.')) {
		return String(detail.game);
	}

	if (action === 'room.kick' || action === 'room.terminate') {
		return `Table ${row.roomCode ?? detail.code}. Reason: ${detail.reason}`;
	}

	if (typeof detail.reason === 'string') {
		return `Reason: ${detail.reason}`;
	}

	if (action === 'tournament.distribute') {
		const automatic = detail.auto ? ', automatic' : '';
		return `${detail.players} players, ${detail.rooms} tables${automatic}`;
	}

	if (action === 'tournament.register') {
		return `${detail.players} players`;
	}

	if (row.targetAdmin) {
		return `Admin ${row.targetAdmin}`;
	}

	return row.roomCode ? `Table ${row.roomCode}` : '';
}
