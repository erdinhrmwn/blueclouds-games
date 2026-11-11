import type { Suit } from 'server/games/cloudburst/rules';

export const SUIT_NAME: Record<Suit, string> = { sun: 'Sun', rain: 'Rain', wind: 'Wind', storm: 'Storm' };
/** Written out in full so Tailwind sees every class. */
export const SUIT_TEXT: Record<Suit, string> = { sun: 'text-sun', rain: 'text-rain', wind: 'text-wind', storm: 'text-storm' };
export const SUIT_BG: Record<Suit, string> = { sun: 'bg-sun', rain: 'bg-rain', wind: 'bg-wind', storm: 'bg-storm' };
