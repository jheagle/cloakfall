import treeloom from 'treeloom'
import { leaveRemoteGame } from '../network/remoteGame'
import { disconnectLobbySocket } from '../network/lobbySocket'
import startMenu from './startMenu'
import type { DomItem, DomItemRoot } from 'treeloom/dist/domItem/types'
import { trackAbandon } from '../track'

/**
 * The final-score screen's Leave button, for a remote game - any player can click it, same as Play Again
 * (there is nothing destructive about leaving). Unlike Play Again, this takes just its own clicker all the way
 * back to the main menu: leaves the finished game (stopping forwarding, clearing the rendered tree - see
 * remoteGame.ts's leaveRemoteGame), disconnects this connection's own lobby socket and clears the shared `?room=`
 * link from the address bar (the same cleanup remoteListener.ts's own leaveToPresets does for the waiting
 * room's Leave button), and shows a freshly rendered menu - whose default screen is the game-type tiles, not
 * the waiting room.
 *
 * This only ever runs client-side, with forwarding already turned off for this exact reason (see
 * remoteGame.ts's enterRemoteGame) - the server's own copy of this listener name is a trivial stand-in, never
 * meant to actually run (see server/gameplay.ts's buildIsolatedRoot).
 * @param e
 * @param target
 */
const remoteLeaveListener = (e: Event, target: DomItem): void => {
  leaveOnlineGame(treeloom.getTopParentItem(target) as DomItemRoot)
}

/**
 * Leave the online game this page is in and go back to the main menu (see remoteLeaveListener). Also the game menu's
 * Leave game (setup/gameActions.ts), mid-game included: the server takes a player who disconnects out of the room
 * (their turns then time out to random shots), and closes the room for everyone when the host does.
 * @param root
 */
export const leaveOnlineGame = (root: DomItemRoot): void => {
  trackAbandon(root, 'leave')
  leaveRemoteGame(root)
  disconnectLobbySocket()
  history.replaceState(null, '', location.pathname)
  startMenu(root)
}

export default remoteLeaveListener
