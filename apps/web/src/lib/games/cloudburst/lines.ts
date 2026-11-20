import type { Card, View } from 'contracts/rooms/cloudburst'
import { SUIT_NAME } from './suits.ts'

// What the table says in words: the dealer's line after each move, and card names inside it.

/** A seated player's name, or "?" for someone no longer at the table. */
export const nameIn = (view: View, id: string | null | undefined): string =>
  view.players.find((player) => player.id === id)?.name ?? '?'

/** "1 card" or "n cards". */
export const cardCount = (cards: number): string => (cards === 1 ? '1 card' : `${cards} cards`)

/** "Sun 7", "Rain Gust", "a Rainbow" or "a Tempest". */
export function cardName(card: Card): string {
  if (card.suit === null) {
    return card.kind === 'rainbow' ? 'a Rainbow' : 'a Tempest'
  }

  const face =
    card.kind === 'number'
      ? String(card.value)
      : card.kind.charAt(0).toUpperCase() + card.kind.slice(1)
  return `${SUIT_NAME[card.suit]} ${face}`
}

/** The end of a play's line when it skips someone, with the cards they draw if any. */
function skippedNote(
  view: View,
  skippedId: string | undefined,
  forced: number | undefined,
): string {
  if (!skippedId) {
    return ''
  }

  if (forced === undefined) {
    return `. ${nameIn(view, skippedId)} is skipped`
  }

  return `. ${nameIn(view, skippedId)} draws ${cardCount(forced)} and is skipped`
}

/** The dealer's line about the latest move. */
export function dealerLine(view: View): string {
  const event = view.lastEvent
  if (!event) {
    return ''
  }

  const nameOf = (id: string | null | undefined) => nameIn(view, id)
  const auto = 'auto' in event && event.auto ? ' (time ran out)' : ''

  switch (event.type) {
    case 'joined':
      return `${nameOf(event.playerId)} sat down.`
    case 'dealt':
      return `Round ${event.round}. Seven cards each.`
    case 'played': {
      const nextSuit = event.card.suit === null ? `, ${SUIT_NAME[view.suit]} next` : ''
      const skip = skippedNote(view, event.skipped, event.forced)
      const gift = event.gaveTo ? ` and handed ${nameOf(event.gaveTo)} a card` : ''
      return `${nameOf(event.playerId)} played ${cardName(event.card)}${nextSuit}${skip}${gift}${auto}.`
    }

    case 'drew':
      if (!event.got) {
        return `The deck is empty. ${nameOf(event.playerId)} can only pass.`
      }

      return `${nameOf(event.playerId)} drew a card${auto}.`
    case 'passed':
      return `${nameOf(event.playerId)} passed${auto}.`
    case 'roundEnd': {
      const tie = event.tie ? ' Tie for fewest points: one more round.' : ''
      return `${nameOf(event.outId)} went out.${tie}`
    }
  }
}
