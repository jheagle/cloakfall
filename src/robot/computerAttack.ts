import attackFleet from '../attack/attackFleet'
import getAttackLock from '../attack/attackLock'
import queueTimeout from '../queue'
import selectTargetCoordinate from './selectTargetCoordinate'
import selectTargetPlayer from './selectTargetPlayer'
import type { Player, Tile } from '../types'

/**
 * How long a robot takes over its turn before it fires, so its shots can be followed (the pace three 400 ms stages of
 * the robot's thinking used to set; the robots-only pace setting, CLOA-9, will make this adjustable).
 */
export const ROBOT_TURN_MS = 1200

/**
 * Main AI logic for computer to attack, selects a target then performs attack function.
 * @param player
 * @param players
 */
const computerAttack = (player: Player, players: Player[]): Player[] => {
  const opponents = players.filter(p => !p.attacker)
  const victim = selectTargetPlayer(opponents)
  // The lock stays on while the robot takes its turn, so nothing can be attacked in the meantime
  const attackLock = getAttackLock(player)
  attackLock.isLocked = true
  const target = selectTargetCoordinate(victim) as Tile
  queueTimeout(player, () => {
    attackLock.isLocked = false
    return attackFleet(target)
  }, ROBOT_TURN_MS)
  return players
}

export default computerAttack
