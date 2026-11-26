/**
 * First-game hints (CLOA-24): a short card on the viewer's first turn that says how to fire, how to pick another
 * opponent, how to see their own fleet, and where the menu is. Family play showed nobody found the menu, the sensor
 * scan or their own board, and with three or more players everyone fired at the first board shown.
 *
 * The card shows once per device (remembered in localStorage), and the menu's "How to play" opens it again. Like the
 * player bar, it lives outside the game's tree (playerBar.ts places it), so a tap on it never reaches a board.
 */
import type { BarPlayer } from './playerBar'

/** The localStorage key that remembers the hints were seen on this device. */
export const HINTS_SEEN_KEY = 'cloakfall:hints-seen'

/** Where "seen" is kept: localStorage in the browser; tests pass their own. */
export interface HintStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** Read "seen", treating a store that throws (private mode, blocked storage) as never seen. */
const wasSeen = (store: HintStore | null): boolean => {
  try {
    return store?.getItem(HINTS_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember "seen"; a store that throws just means the hints may show again next time. */
const markSeen = (store: HintStore | null): void => {
  try {
    store?.setItem(HINTS_SEEN_KEY, '1')
  } catch {}
}

/**
 * The hints for this game, in order. Only what applies: picking an opponent only with two or more to choose from,
 * the own fleet only when the viewer has one.
 * @param players
 */
export const hintLines = (players: BarPlayer[]): string[] => {
  const opponents = players.filter(player => !player.own && player.status > 0).length
  const own = players.some(player => player.own)
  return [
    'Tap a square on an opponent\'s board to fire.',
    ...(opponents > 1 ? [`You have ${opponents} opponents: tap a name in the bar at the bottom to choose whose board to fire at.`] : []),
    ...(own ? ['Tap your own name (you) in the bar to see your fleet.'] : []),
    'Open the menu (☰) for your controls, like the sensor scan when the game has it, and to restart or quit.'
  ]
}

/** Whether it is the viewer's own turn: they have a board to fire at. */
const myTurn = (players: BarPlayer[]): boolean => players.some(player => player.own) && players.some(player => player.target)

/** What the bar needs from the hints. */
export interface FirstGameHints {
  element: HTMLElement
  isOpen: () => boolean
  /** Open it (from the menu), with these players' hints. */
  open: (players: BarPlayer[]) => void
  close: () => void
  /** Called on every bar refresh: opens the card on the viewer's first turn ever, closes it when play stops. */
  update: (players: BarPlayer[], playing: boolean) => void
}

/**
 * Build the hints card (not yet in the page: the bar places it).
 * @param doc
 * @param store where "seen" is remembered (localStorage by default, null for nowhere)
 */
export const createFirstGameHints = (doc: Document, store: HintStore | null = defaultStore(doc)): FirstGameHints => {
  const element = doc.createElement('div')
  element.className = 'first-game-hints'
  element.id = 'first-game-hints'
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-labelledby', 'first-game-hints-title')
  element.hidden = true
  const title = doc.createElement('h2')
  title.id = 'first-game-hints-title'
  title.textContent = 'How to play'
  const list = doc.createElement('ul')
  const done = doc.createElement('button')
  done.type = 'button'
  done.className = 'first-game-hints-done'
  done.textContent = 'Got it'
  element.append(title, list, done)

  // Shown automatically at most once per page load, even where storage doesn't work
  let shownThisVisit = false

  const open = (players: BarPlayer[]): void => {
    list.replaceChildren(...hintLines(players).map(line => Object.assign(doc.createElement('li'), { textContent: line })))
    element.hidden = false
    done.focus()
  }

  const close = (): void => {
    if (element.hidden) {
      return
    }
    element.hidden = true
    markSeen(store)
  }

  done.addEventListener('click', close)
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  })

  const update = (players: BarPlayer[], playing: boolean): void => {
    if (!playing) {
      element.hidden = true
      return
    }
    if (!shownThisVisit && myTurn(players) && !wasSeen(store)) {
      shownThisVisit = true
      open(players)
    }
  }

  return { element, isOpen: () => !element.hidden, open, close, update }
}

/** The page's localStorage, or null where there is none (or reading it throws). */
function defaultStore (doc: Document): HintStore | null {
  try {
    return doc.defaultView?.localStorage ?? null
  } catch {
    return null
  }
}

export default createFirstGameHints
