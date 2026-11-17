import treeloom from 'treeloom'
import shadeShips from '../cells/shadeShips'
import type { DomItem } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/**
 * The robots-only game's "Show all ships" control: shows or hides the ships on every board at once. (Single player's
 * own "Show my ships" checkbox is gone: the human's own ships always show.)
 * @param e
 * @param target
 */
const shipsListener = (e: Event, target: DomItem): void => {
  const input = e.target as HTMLInputElement
  const set = (player: Player): void => {
    player.showShips = input.checked
    shadeShips(player, input.checked)
  }
  if (input.className.includes('all-ships')) {
    const root = treeloom.getTopParentItem(target)
    const boards = treeloom.getChildrenByClass('boards', root.body)[0] as unknown as { children: Player[] }
    boards.children.forEach(set)
  }
}

export default shipsListener
