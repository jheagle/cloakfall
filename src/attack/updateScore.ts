import computerAttack from '../robot/computerAttack'
import endGame from './endGame'
import getAttackLock from './attackLock'
import getNextAttacker from './getNextAttacker'
import queueTimeout from '../queue'
import updatePlayer from './updatePlayer'
import { getGameMode } from '../setup/gameOptions'
import { getSession } from '../setup/gameSession'
import type { DomItem } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/**
 * How long a shot's result stays in view before the turn passes, in local multiplayer: there the whole screen switches
 * to the next player's point of view at once, so without a pause the shooter never saw where their shot landed. Other
 * games keep their pace: a robot takes its own time before firing (computerAttack's ROBOT_TURN_MS), and online every
 * player keeps their own view.
 */
export const HIT_PAUSE_MS = 900

/**
 * The pause before the turn passes after this attacker's shot: HIT_PAUSE_MS in local multiplayer, none otherwise.
 * Online rooms run the same game code on the server (their session has onAttackerChanged), so they are told apart.
 * @param attacker
 */
const hitPause = (attacker: Player): number => getGameMode(attacker as unknown as DomItem) === 'multi' &&
  !getSession(attacker as unknown as DomItem).onAttackerChanged
  ? HIT_PAUSE_MS
  : 0

/**
 * Update all game stats after each player round: pass the turn (after a short pause in local multiplayer, with the
 * attack lock on so nothing else can be fired meanwhile), or end the game.
 * @param hitShip
 * @param sunkShip
 * @param players
 */
const updateScore = (hitShip: boolean, sunkShip: number, players: Player[]): Player[] => {
  players = players.filter((p) => p.status > 0)
  const shooter = players.reduce((p1, p2) => p1.attacker ? p1 : p2)
  const passTurn = (): void => {
    const attacker = updatePlayer(shooter, hitShip, sunkShip)
    if (players.length < 2) {
      queueTimeout(attacker, () => endGame(players[0]), 200)
      return
    }
    const nextAttacker = getNextAttacker(attacker, players, hitShip)
    if (nextAttacker.isRobot) {
      queueTimeout(attacker, computerAttack, 0, nextAttacker, players)
    }
  }
  const pause = players.length < 2 ? 0 : hitPause(shooter)
  if (pause > 0) {
    getAttackLock(shooter).isLocked = true
    queueTimeout(shooter, passTurn, pause)
    return players
  }
  passTurn()
  return players
}

export default updateScore
