/** Longest reason an admin can give when disabling a player. */
export const REASON_MAX = 200;

/** The most players a tournament may take; the column allows up to this. */
export const MAX_PLAYERS_LIMIT = 10_000;

/** Longest texts a tournament keeps for its lobby card and Detail dialog (migration 019). */
export const TOURNAMENT_TEXT_MAX = { description: 1000, prizeExtra: 40 } as const;

/** Most finishing places a tournament pays (migration 020). */
export const PRIZE_PLACES_MAX = 10;

/** Highest fee in coins a tournament may ask; the column allows up to this. */
export const FEE_MAX = 1_000_000_000;
