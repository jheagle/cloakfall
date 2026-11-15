import type { ForwardedEvent } from 'treeloom/dist/events/types'
import type { HintSetting } from '../src/setup/gameOptions'

/**
 * Checks for what clients send the lobby. Every socket event's payload comes straight off the network, so it can be
 * anything at all (missing, null, a number, an object with the wrong field types) whatever the TypeScript types in
 * lobbyServer.ts say: these turn it into known shapes, or a reason to refuse it.
 */

/** The longest player name the lobby accepts. */
export const MAX_PLAYER_NAME = 24

/** The longest lobby (room) name the lobby accepts. */
export const MAX_LOBBY_NAME = 40

/** The hint settings a game can start with (see src/setup/gameOptions.ts). */
export const HINT_SETTINGS: readonly HintSetting[] = ['off', 'optional', 'on']

/** The longest event type a game action may name (real ones are short: click, change, input, submit...). */
const MAX_EVENT_TYPE = 32

/**
 * Whether a value is a plain object (not null, not an array) - the only payload shape any lobby event takes.
 * @param value
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Characters a name never needs that can make it look blank or like someone else's: control characters (C0/C1),
 * the soft hyphen, zero-width spaces and marks (U+200B, U+200C, U+200E, U+200F), bidi embeddings/overrides/isolates
 * (U+202A-U+202E, U+2066-U+2069), invisible operators (U+2060-U+2064) and the byte-order mark. The zero-width joiner
 * (U+200D) stays: emoji sequences such as families and flags need it.
 */
// eslint-disable-next-line no-control-regex, no-misleading-character-class
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/**
 * A name from a client, cleaned: hidden characters removed (see HIDDEN_CHARACTERS; they can't be typed, only sent by
 * hand or pasted), runs of whitespace collapsed, trimmed. Resolves to the cleaned name, or the error to show if it is missing or too long.
 * @param value Whatever the client sent.
 * @param max The longest allowed, after cleaning.
 * @param missing The error when there is no name at all.
 * @param tooLong The error when it is longer than max.
 */
export const cleanName = (value: unknown, max: number, missing: string, tooLong: string): { name: string } | { error: string } => {
  const name = typeof value === 'string'
    ? value.replace(HIDDEN_CHARACTERS, '').replace(/\s+/g, ' ').trim()
    : ''
  if (!name) {
    return { error: missing }
  }
  if (name.length > max) {
    return { error: tooLong }
  }
  return { name }
}

/**
 * Whether a value is one of the hint settings.
 * @param value
 */
export const isHintSetting = (value: unknown): value is HintSetting => HINT_SETTINGS.includes(value as HintSetting)

/**
 * A game action rebuilt from only the fields the server uses, or null if it isn't one. targetState keeps only what
 * treeloom's sender ever puts there - a form field's `value` (a string) or a checkbox's `checked` (a boolean) - since
 * receiveForwardedEvent copies every key of it onto the server's own element.
 * @param value Whatever the client sent.
 */
export const cleanGameAction = (value: unknown): ForwardedEvent | null => {
  if (!isRecord(value) || !Number.isInteger(value.itemId) || typeof value.eventType !== 'string' ||
    !value.eventType || value.eventType.length > MAX_EVENT_TYPE) {
    return null
  }
  const action: ForwardedEvent = {
    itemId: value.itemId as number,
    eventType: value.eventType as ForwardedEvent['eventType'],
    listenerFunc: typeof value.listenerFunc === 'string' ? value.listenerFunc : '',
    // Never read on this side: treeloom's receiveForwardedEvent dispatches a fresh event on the resolved element and
    // only the listeners already bound to it run, with their own registered args; envelope.data is ignored.
    data: []
  }
  if (isRecord(value.targetState)) {
    const { value: fieldValue, checked } = value.targetState
    if (typeof fieldValue === 'string') {
      action.targetState = { value: fieldValue }
    } else if (typeof checked === 'boolean') {
      action.targetState = { checked }
    }
  }
  return action
}
