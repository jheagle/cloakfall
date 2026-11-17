import treeloom from 'treeloom'
import randomAttack from '../attack/randomAttack'
import { getSession } from './gameSession'
import { TURN_DEADLINE_EVENT } from '../view/turnBanner'
import type { DomItem, DomItemRoot } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/** How long a human has for a turn when the local turn timer is on: the same as an online game's (server/gameplay.ts). */
export const LOCAL_TURN_MS = 20000

/** The pending random shot, per game root: whose turn it is waiting on, and its timer. */
const pending = new WeakMap<object, { player: Player, timer: ReturnType<typeof setTimeout> }>()

/** Tell the turn banner when this turn runs out (null: no limit). */
const tellDeadline = (deadline: number | null): void => {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(TURN_DEADLINE_EVENT, { detail: { deadline } }))
  }
}

/** Cancel the root's pending random shot, if any, and tell the banner there is no limit now. */
const stop = (root: DomItemRoot): void => {
  const waiting = pending.get(root)
  if (waiting) {
    clearTimeout(waiting.timer)
    pending.delete(root)
  }
  tellDeadline(null)
}

/**
 * Start a human's turn clock: when it runs out, a random shot is fired for them (randomAttack, as an online game's
 * server does), unless the turn has ended or the game was stopped (quit, restart) in the meantime.
 * @param root
 * @param player
 */
const start = (root: DomItemRoot, player: Player): void => {
  stop(root)
  const session = getSession(root as unknown as DomItem)
  const generation = session.generation
  const deadline = Date.now() + LOCAL_TURN_MS
  const timer = setTimeout(() => {
    pending.delete(root)
    if (session.generation !== generation || !player.attacker) {
      return
    }
    tellDeadline(null)
    const players = treeloom.getParentsByClass('boards', player as unknown as DomItem)[0]?.children as Player[] | undefined
    if (players) {
      randomAttack(player, players)
    }
  }, LOCAL_TURN_MS)
  pending.set(root, { player, timer })
  tellDeadline(deadline)
}

/**
 * Keep the local turn clock in step with a player whose attacker flag just changed (updatePlayer.ts). A human's turn
 * starts it when the timer is on; any other start (a robot) or the end of the clocked player's turn stops it. Online
 * games keep their own server-side clock (session.onAttackerChanged), so nothing happens there.
 * @param player
 */
export const syncLocalTurnTimer = (player: Player): void => {
  const session = getSession(player as unknown as DomItem)
  if (session.onAttackerChanged) {
    return
  }
  const root = treeloom.getTopParentItem(player as unknown as DomItem) as DomItemRoot
  if (player.attacker) {
    if (session.turnTimer && !player.isRobot) {
      start(root, player)
    } else {
      stop(root)
    }
  } else if (pending.get(root)?.player === player) {
    stop(root)
  }
}

/**
 * Switch the local turn timer on or off (the game menu): it applies at once to the human whose turn it is (a fresh full
 * turn), and stays as set for the next games on this page.
 * @param root
 * @param on
 */
export const setLocalTurnTimer = (root: DomItemRoot, on: boolean): void => {
  const session = getSession(root as unknown as DomItem)
  session.turnTimer = on
  const boards = root.body.children.find(child => String(child.attributes?.className ?? '') === 'boards')
  const attacker = ((boards?.children ?? []) as unknown as Player[]).find(player => player.attacker)
  if (on && attacker && !attacker.isRobot) {
    start(root, attacker)
  } else {
    stop(root)
  }
}
