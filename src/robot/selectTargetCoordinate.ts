import treeloomMatrix from 'treeloom-matrix'
import siFunciona from 'si-funciona'
import filterAdjacentPoints from '../utils/filterAdjacentPoints'
import getAllNonHitCells from '../utils/getAllNonHitCells'
import { densityChoices } from './densityTargets'
import type { Player, Tile } from '../types'

/**
 * Choose which coordinate to attack, in layers: the density model first, then the checkerboard over every unattacked
 * cell. Nothing is drawn while choosing: only the shot shows (only the current attacker is highlighted).
 * @param victim
 */
const selectTargetCoordinate = (victim: Player): Tile | false => {
  const { targets } = densityChoices(victim)
  const finalTargets = targets.length ? targets : getAllNonHitCells(victim.board).filter(t => filterAdjacentPoints(t))
  const target = finalTargets[siFunciona.randomInteger(finalTargets.length)]
  // Hit one of the most likely cells at random
  return treeloomMatrix.getDomItemFromPoint(target, victim.board) as Tile | false
}

export default selectTargetCoordinate
