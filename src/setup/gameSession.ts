import treeloom from 'treeloom'
import siFunciona from 'si-funciona'
import type { DomItem, DomItemRoot } from 'treeloom/dist/domItem/types'
import type { GameMode, GameSettings, HintSetting } from './gameOptions'
import type { PlacementSession } from './placement'
import type { Player } from '../types'

/**
 * Everything one game needs that used to live in a handful of module-level singletons: the lobby settings, the
 * attack lock, the timed queue every action runs on, and the in-progress placement phase, if any. One of these
 * exists per game, keyed by that game's own document root - see getSession.
 */
export interface GameSession {
  hints: HintSetting
  mode: GameMode
  settings: GameSettings
  attackLock: { isLocked: boolean }
  queue: (fn: Function, time?: number, ...args: any[]) => Promise<any>
  /** Which game on this root the queue is running steps for: stopGame bumps it, and a step queued for an earlier one
   * is skipped when its turn comes (see queue.ts), so a game that was quit or restarted can't keep playing. */
  generation: number
  /** Local games: whether a human's turn has a time limit, after which a random shot is fired for them (the game
   * menu's "Turn timer", setup/localTurnTimer.ts). Kept for the next games on the same page. */
  turnTimer: boolean
  placement: PlacementSession | null
  /** Overrides how endGame.ts shows the final score, for a remote room's game - see gameplay.ts's startRoomGame.
   * null (the default) keeps local hot-seat's own finalScore screen and its Play Again/Change Settings/Main Menu
   * buttons, which only make sense for one physical screen controlling the whole game. */
  onGameOver: ((players: Player[], parent: DomItemRoot) => void) | null
  /** Called whenever a human player becomes the attacker - see updatePlayer.ts, the one place a player's own
   * attacker flag actually flips. null (the default) for local hot-seat, which has no need for a per-turn
   * timer (one shared screen, nobody to stall). Set by a remote room's game (see gameplay.ts's startRoomGame)
   * to start/reset that player's own turn-timeout deadline. */
  onAttackerChanged: ((attacker: Player, root: DomItemRoot) => void) | null
}

const sessions = new WeakMap<DomItemRoot, GameSession>()

const defaultSession = (): GameSession => ({
  hints: 'optional',
  mode: 'robots',
  settings: { humans: 0, robots: 2, firstGoesFirst: true },
  attackLock: { isLocked: false },
  queue: siFunciona.queueTimeout(),
  generation: 0,
  turnTimer: false,
  placement: null,
  onGameOver: null,
  onAttackerChanged: null
})

/**
 * The session for whichever game `item` belongs to - any DomItem in that game's tree, or its root itself, works the
 * same way. A game gets its own session the first time anything asks for it, and it is garbage-collected along with
 * its root once nothing else references the game any more - there is nothing to explicitly tear down.
 * @param item
 */
export const getSession = (item: DomItem): GameSession => {
  const root = treeloom.getTopParentItem(item)
  if (!sessions.has(root)) {
    sessions.set(root, defaultSession())
  }
  return sessions.get(root) as GameSession
}

/**
 * Stop the game running on this root, mid-game included: every step already queued for it (a robot's next shot, a
 * turn change) is skipped instead of run, any placement in progress is dropped, and the attack lock is released. The
 * root keeps its settings, so a new game can start on it (startNewGame calls this first).
 * @param item the root, or anything in its tree
 */
export const stopGame = (item: DomItem): void => {
  const session = getSession(item)
  session.generation++
  session.placement = null
  session.attackLock.isLocked = false
}
