/**
 * The turn banner: across the top of the screen during play, whose turn it is ("Your turn, Ann", "Waiting for Bob to
 * fire", or in robots only "Robot 2 is firing"), sliding in afresh at every turn change, with a countdown when the turn
 * has a time limit (online: the server's turn timer).
 *
 * Like the player bar, it lives outside the game's tree and is driven by the bar's refresh (playerBar.ts), which
 * already knows who is firing and who the viewer is. The text is a live region, so a turn change is announced; the
 * countdown beside it is not (it would be read out every second).
 */
import type { BarPlayer } from './playerBar'

/**
 * The event that tells the banner when the current turn runs out (detail: { deadline: number | null }, a Date.now()
 * time, or null for no limit), sent on the document. Online games send it from the server's pushes
 * (network/remoteGame.ts).
 */
export const TURN_DEADLINE_EVENT = 'cloakfall:turn-deadline'

/**
 * What the banner says for a turn: the viewer's own ("Your turn, Ann": in local multiplayer the player holding the
 * device), someone else's while the viewer waits, or, with no viewer at all (robots only), who is firing. Null between
 * turns (nobody firing), when the banner keeps what it said.
 * @param players
 */
export const turnText = (players: BarPlayer[]): string | null => {
  const attacker = players.find(player => player.turn === 'attacker')
  if (!attacker) {
    return null
  }
  if (attacker.own) {
    return `Your turn, ${attacker.name}`
  }
  return players.some(player => player.own) ? `Waiting for ${attacker.name} to fire` : `${attacker.name} is firing`
}

/** Seconds left until a deadline, never below 0. */
export const secondsLeft = (deadline: number, now: number = Date.now()): number => Math.max(0, Math.ceil((deadline - now) / 1000))

/** What the bar needs from the banner. */
export interface TurnBanner {
  element: HTMLElement
  /** Show (or hide, when not in play) the banner for these players. */
  update: (players: BarPlayer[], playing: boolean) => void
  destroy: () => void
}

/**
 * Build the banner (not yet in the page: the bar places it).
 * @param doc
 */
export const createTurnBanner = (doc: Document): TurnBanner => {
  const element = doc.createElement('div')
  element.className = 'turn-banner'
  element.hidden = true
  const text = doc.createElement('span')
  text.className = 'turn-banner-text'
  text.setAttribute('role', 'status')
  const countdown = doc.createElement('span')
  countdown.className = 'turn-banner-countdown'
  countdown.setAttribute('aria-hidden', 'true')
  countdown.hidden = true
  element.append(text, countdown)

  let deadline: number | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let attackerKey: string | null = null

  const tick = (): void => {
    if (deadline === null) {
      countdown.hidden = true
      return
    }
    countdown.hidden = false
    countdown.textContent = `${secondsLeft(deadline)}s`
  }

  const onDeadline = (event: Event): void => {
    const next = (event as CustomEvent<{ deadline?: number | null }>).detail?.deadline
    deadline = typeof next === 'number' && next > 0 ? next : null
    if (deadline !== null && ticker === null) {
      ticker = setInterval(tick, 250)
    }
    if (deadline === null && ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
    tick()
  }
  doc.addEventListener(TURN_DEADLINE_EVENT, onDeadline)

  const update = (players: BarPlayer[], playing: boolean): void => {
    if (!playing) {
      element.hidden = true
      attackerKey = null
      doc.body.classList.remove('has-turn-banner')
      return
    }
    const words = turnText(players)
    const attacker = players.find(player => player.turn === 'attacker')
    if (words !== null && text.textContent !== words) {
      text.textContent = words
    }
    element.style.setProperty('--player-colour', attacker?.colour ?? '')
    // A new turn slides in afresh (the animation restarts when the class is put back on)
    const key = attacker ? `${attacker.id}:${String(attacker.own)}` : attackerKey
    if (attacker && key !== attackerKey) {
      attackerKey = key
      element.classList.remove('is-new')
      // Reading the layout makes the browser see the class gone, so adding it back restarts the animation
      element.getBoundingClientRect()
      element.classList.add('is-new')
    }
    element.hidden = false
    doc.body.classList.add('has-turn-banner')
  }

  const destroy = (): void => {
    doc.removeEventListener(TURN_DEADLINE_EVENT, onDeadline)
    if (ticker !== null) {
      clearInterval(ticker)
    }
    element.remove()
    doc.body.classList.remove('has-turn-banner')
  }

  return { element, update, destroy }
}

export default createTurnBanner
