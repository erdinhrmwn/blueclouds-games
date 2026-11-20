import type { LiveTournament, Tournament } from '#lib/platform.ts'
import { ordinal, pointsText, ranksByPoints, startsIn } from '#lib/tournament-formats.ts'

/** A tournament with the game it is played in. */
export type OfGame<T> = T & { game: string }

// What a tournament card says about where a tournament is, and what its main button does.

/** `dot`: the colour of the dot beside the label. The chip itself is always dark, so it reads on any felt. */
export interface Status {
  label: string
  dot: string
}

export const SIGN_UP_OPEN: Status = { label: 'Sign-up open', dot: 'bg-go' }
export const STARTING_SOON: Status = { label: 'Starting soon', dot: 'bg-brass' }
export const FULL: Status = { label: 'Sign-up closed', dot: 'bg-ember' }

/** Join or Leave, as the card and its Detail show it. */
export interface CardAction {
  label: string
  style: string
  disabled: boolean
}

const isFull = (tournament: Tournament) =>
  tournament.maxPlayers !== null && tournament.registered >= tournament.maxPlayers

/** A tournament open for sign-up until it fills or sign-up closes; after that it is about to start. */
export function openStatus(tournament: Tournament, now = Date.now()): Status {
  const closesAt = Date.parse(tournament.registrationClosesAt)
  if (now >= closesAt) {
    return STARTING_SOON
  }

  if (isFull(tournament)) {
    return FULL
  }

  return SIGN_UP_OPEN
}

/** Coins missing to join; 0 when the player can afford it (or it's free, or they're in). */
export const shortBy = (tournament: Tournament, coins: number): number =>
  tournament.joined ? 0 : Math.max(tournament.fee - coins, 0)

/**
 * The card's main button: Leave for a player who is in; Join in brass while sign-up is open, else a quiet outline
 * that reads as off. `saving` while this tournament's join or leave is on its way.
 */
export function actionOf(
  tournament: Tournament,
  status: Status,
  { saving, coins }: { saving: boolean; coins: number },
): CardAction {
  if (tournament.joined) {
    return { label: saving ? 'Saving…' : 'Leave', style: 'btn-ghost', disabled: saving }
  }

  const affordable = shortBy(tournament, coins) === 0
  if (status === SIGN_UP_OPEN && affordable) {
    return { label: saving ? 'Saving…' : 'Join', style: 'btn-brass', disabled: saving }
  }

  return {
    label: 'Join',
    style: 'btn border border-paper/25 bg-black/20 text-paper',
    disabled: true,
  }
}

/** "Stage 2 of 3" for Arena and Swiss; a knockout plays until one is left, so just "Stage 2". */
export function stageLabel(tournament: LiveTournament): string {
  if (!ranksByPoints(tournament.format)) {
    return `Stage ${tournament.round}`
  }

  return `Stage ${tournament.round} of ${tournament.rounds ?? 3}`
}

/** The felt's line: when the stage starts, or that it is being played. */
export function stageLine(tournament: LiveTournament, now: number): string {
  if (tournament.roundStarted) {
    return `Stage ${tournament.round} in play`
  }

  return startsIn(tournament.roundStartsAt, now)
}

/** The brass line under the name: where the player stands. */
export function myLine(tournament: LiveTournament): string | null {
  const me = tournament.me
  if (!me) {
    return tournament.table ? 'You’re in' : null
  }

  if (ranksByPoints(tournament.format)) {
    return `You’re ${ordinal(me.place)} with ${pointsText(me.points)}`
  }

  if (tournament.table) {
    return `You’re in stage ${tournament.round}`
  }

  return `You’re out · ${ordinal(me.place)}`
}

/** A standings row's right side: points, or how far a knockout player got. */
export function rowNote(
  tournament: LiveTournament,
  standing: LiveTournament['top'][number],
): string {
  if (ranksByPoints(tournament.format)) {
    return `${standing.points} ${standing.points === 1 ? 'pt' : 'pts'}`
  }

  return standing.lastRound >= tournament.round ? 'in' : `out in stage ${standing.lastRound}`
}
