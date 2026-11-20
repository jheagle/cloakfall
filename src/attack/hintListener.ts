import treeloom from 'treeloom'
import siFunciona from 'si-funciona'
import { clearHeatHint, showHeatHint, victimsOf } from './heatHint'
import { track } from '../track'
import type { DomItem } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/**
 * The hint checkbox in a human's panel: switching it on shows the heat map at once if it is their turn.
 * @param e
 * @param target
 */
const hintListener = (e: Event, target: DomItem): void => {
  const player = treeloom.getParentsByClass('player', target)[0] as unknown as Player
  player.showHint = (e.target as HTMLInputElement).checked
  track(`hint-checkbox-${player.showHint ? 'on' : 'off'}`, `Hint checkbox switched ${player.showHint ? 'on' : 'off'}`)
  // The checkbox's own item records it too: in online play the screen each player gets is built from the items, so
  // without this every push until the stats are next rebuilt (updatePlayerStats) would show the box unchecked again
  treeloom.updateElement(siFunciona.mergeObjectsMutable(target, { attributes: { checked: player.showHint } }) as DomItem)
  if (!player.attacker) {
    return // The hint only shows during the player's own turn; updatePlayer shows it when the turn starts
  }
  victimsOf(player).forEach(victim => player.showHint ? showHeatHint(victim) : clearHeatHint(victim))
}

export default hintListener
