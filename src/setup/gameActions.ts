import { GAME_ACTION_EVENT, GAME_ACTIONS_QUERY } from '../view/controlPanel'
import { getGameSettings, getHintSetting } from './gameOptions'
import { stopGame } from './gameSession'
import { startNewGame } from './startNewGame'
import { leaveOnlineGame } from './remoteLeaveListener'
import { getLastRoomState } from './remoteListener'
import { getSocketId, hostGameAction } from '../network/lobbySocket'
import startMenu from './startMenu'
import type { GameAction } from '../view/controlPanel'
import type { DomItemRoot } from 'treeloom/dist/domItem/types'

/** Whether this page is showing an online game (rendered from the server's pushes: remoteGame.ts sets forwarding). */
const isOnline = (root: DomItemRoot): boolean => Boolean((root as DomItemRoot & { forwardEvents?: unknown }).forwardEvents)

/**
 * The game menu's "Game" section for what is on screen now. Local games (single player, local multiplayer, robots
 * only): Restart with the same settings, and Quit to the main menu. Online, the host: Restart (a new game for everyone,
 * same settings) and Return to lobby (everyone back to the waiting room), both through the server's hostGameAction;
 * everyone: Leave game, which for the host ends it for everyone (the server closes a room its host leaves).
 * @param root
 */
export const gameActionsFor = (root: DomItemRoot): GameAction[] => {
  if (isOnline(root)) {
    const host = getLastRoomState()?.hostId === getSocketId()
    const leave: GameAction = {
      id: 'leave',
      label: 'Leave game',
      confirm: host ? 'Leave the game? You are the host: it ends for everyone.' : 'Leave the game? The others play on without you.',
      confirmLabel: 'Leave'
    }
    return host
      ? [
          { id: 'restart', label: 'Restart', confirm: 'Start a new game for everyone with the same settings? This one ends.', confirmLabel: 'Restart' },
          { id: 'lobby', label: 'Return to lobby', confirm: 'End this game for everyone and go back to the waiting room?', confirmLabel: 'Return to lobby' },
          leave
        ]
      : [leave]
  }
  return [
    { id: 'restart', label: 'Restart', confirm: 'Start a new game with the same settings? This one ends.', confirmLabel: 'Restart' },
    { id: 'quit', label: 'Quit to main menu', confirm: 'Quit this game and go back to the main menu?', confirmLabel: 'Quit' }
  ]
}

/**
 * Do what the viewer confirmed in the game menu.
 * @param root
 * @param action
 */
export const runGameAction = (root: DomItemRoot, action: string): void => {
  if (isOnline(root)) {
    if (action === 'leave') {
      leaveOnlineGame(root)
    } else if (action === 'restart' || action === 'lobby') {
      // Everyone, the host included, is then sent back to the waiting room by the server (remoteListener.ts)
      hostGameAction(action).catch(() => {})
    }
    return
  }
  if (action === 'restart') {
    const { humans, robots, firstGoesFirst } = getGameSettings(root)
    startNewGame(root, humans, robots, firstGoesFirst, getHintSetting(root))
  } else if (action === 'quit') {
    stopGame(root)
    startMenu(root)
  }
}

const listening = new WeakSet<object>()

/**
 * Answer the game menu (view/controlPanel.ts) on the game's <main>, once per page: which actions apply, and running
 * the one confirmed.
 * @param root
 */
export const listenForGameActions = (root: DomItemRoot): void => {
  const main = root.body?.element as HTMLElement | undefined
  if (!main?.addEventListener || listening.has(main)) {
    return
  }
  listening.add(main)
  main.addEventListener(GAME_ACTIONS_QUERY, event => {
    (event as CustomEvent<{ actions: GameAction[] }>).detail.actions.push(...gameActionsFor(root))
  })
  main.addEventListener(GAME_ACTION_EVENT, event => {
    runGameAction(root, String((event as CustomEvent<{ action?: string }>).detail?.action ?? ''))
  })
}
