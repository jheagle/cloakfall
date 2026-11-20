import { GAME_ACTION_EVENT, GAME_ACTIONS_QUERY } from '../view/controlPanel'
import { getGameMode, getGameSettings, getHintSetting } from './gameOptions'
import { getSession, stopGame } from './gameSession'
import { LOCAL_TURN_MS, setLocalTurnTimer } from './localTurnTimer'
import { startNewGame } from './startNewGame'
import { leaveOnlineGame } from './remoteLeaveListener'
import { getLastRoomState } from './remoteListener'
import { getSocketId, hostGameAction } from '../network/lobbySocket'
import startMenu from './startMenu'
import { trackAbandon } from '../track'
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
  // The turn timer: only where a human takes turns (not robots only), as a switch
  const timer: GameAction[] = getGameMode(root) === 'robots'
    ? []
    : [{ id: 'turn-timer', label: `Turn timer (${LOCAL_TURN_MS / 1000} s, then a random shot)`, setting: { checked: getSession(root).turnTimer } }]
  return [
    ...timer,
    { id: 'restart', label: 'Restart', confirm: 'Start a new game with the same settings? This one ends.', confirmLabel: 'Restart' },
    { id: 'quit', label: 'Quit to main menu', confirm: 'Quit this game and go back to the main menu?', confirmLabel: 'Quit' }
  ]
}

/**
 * Do what the viewer confirmed in the game menu.
 * @param root
 * @param action
 * @param checked a setting's new value (the turn timer)
 */
export const runGameAction = (root: DomItemRoot, action: string, checked: boolean = false): void => {
  if (isOnline(root)) {
    if (action === 'leave') {
      leaveOnlineGame(root)
    } else if (action === 'restart' || action === 'lobby') {
      // Everyone, the host included, is then sent back to the waiting room by the server (remoteListener.ts)
      hostGameAction(action).catch(() => {})
    }
    return
  }
  if (action === 'turn-timer') {
    setLocalTurnTimer(root, checked)
  } else if (action === 'restart') {
    const { humans, robots, firstGoesFirst } = getGameSettings(root)
    startNewGame(root, humans, robots, firstGoesFirst, getHintSetting(root))
  } else if (action === 'quit') {
    trackAbandon(root, 'quit')
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
    const detail = (event as CustomEvent<{ action?: string, checked?: boolean }>).detail
    runGameAction(root, String(detail?.action ?? ''), Boolean(detail?.checked))
  })
}
