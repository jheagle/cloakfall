import shadeShips from '../cells/shadeShips'
import { getGameMode } from './gameOptions'
import { getSession } from './gameSession'
import { OWN_BOARD_EVENT } from '../view/playerBar'
import type { DomItem, DomItemRoot } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/**
 * Local multiplayer (hot-seat) only: a player's ships stay hidden in play, since others share the screen, but show on
 * their own board while they have it open on their own turn. Not during placement, which shows the placing player's
 * ships itself. Every human's ships are hidden first, so the last
 * player's never stay shown after the device is passed on.
 * @param players
 * @param open
 */
export const revealOwnShips = (players: Player[], open: boolean): void => {
  const humans = players.filter(player => !player.isRobot)
  humans.forEach(player => shadeShips(player, false))
  if (!open) {
    return
  }
  const own = humans.find(player => String(player.attributes?.className ?? '').split(' ').includes('role-own'))
  if (own) {
    shadeShips(own, true)
  }
}

const listening = new WeakSet<object>()

/**
 * Listen for the player bar's own-board event (OWN_BOARD_EVENT) on the game's <main>, once per page. It acts only in a local
 * multiplayer game: single player always shows the human's own ships, robots-only has no own board, and an online
 * game (rendered from the server's pushes, root.forwardEvents set) has the server decide what each player sees.
 * @param root
 */
export const listenForOwnBoard = (root: DomItemRoot): void => {
  const main = root.body?.element as HTMLElement | undefined
  if (!main?.addEventListener || listening.has(main)) {
    return
  }
  listening.add(main)
  main.addEventListener(OWN_BOARD_EVENT, event => {
    if ((root as DomItemRoot & { forwardEvents?: unknown }).forwardEvents || getGameMode(root as unknown as DomItem) !== 'multi') {
      return
    }
    // While ships are being placed the bar is not in play and says the own board is closed (on every change to the
    // page), which would hide the ships the player is placing as fast as they appear: placement shades its own
    if (getSession(root as unknown as DomItem).placement) {
      return
    }
    const boards = root.body.children.find(child => String(child.attributes?.className ?? '') === 'boards')
    revealOwnShips((boards?.children ?? []) as unknown as Player[], Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open))
  })
}
