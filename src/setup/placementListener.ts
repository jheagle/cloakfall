import treeloom from 'treeloom'
import { chooseOrder, continueTurn, finishTurn, pickOrder, randomOrder, randomise } from './placement'
import { isRemoteSessionActive, pickRemoteOrder } from './remotePlacement'
import { ORDER_PICK_CLASS } from './orderPicks'
import type { DomItem } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/**
 * The placement buttons: Continue (after the handoff), Randomise, Done, Random and Set order, and each player's name
 * on the turn-order screen (orderPicks.ts, local and online alike). They are told apart by class name.
 * @param e
 * @param target
 */
const placementListener = (e: Event, target: DomItem): void => {
  const className = (e.target as HTMLElement).className
  if (className.includes('placement-continue')) {
    continueTurn(target)
  } else if (className.includes('placement-randomise')) {
    randomise(target)
  } else if (className.includes('placement-done')) {
    finishTurn(target)
  } else if (className.includes('begin-random')) {
    randomOrder(target)
  } else if (className.includes('begin-order')) {
    chooseOrder(target)
  } else if (className.includes(ORDER_PICK_CLASS)) {
    const player = treeloom.getParentsByClass('player', target)[0] as unknown as Player | undefined
    if (!player) {
      return
    }
    if (isRemoteSessionActive(target)) {
      pickRemoteOrder(player)
    } else {
      pickOrder(target, player)
    }
  }
}

export default placementListener
