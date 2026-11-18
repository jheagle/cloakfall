import treeloom from 'treeloom'
import siFunciona from 'si-funciona'
import type { DomItem, DomItemConfig } from 'treeloom/dist/domItem/types'
import type { Player } from '../types'

/** The class of each player's name button on the turn-order screen, and how placementListener tells it apart. */
export const ORDER_PICK_CLASS = 'order-pick'

/**
 * A player's name button for the turn-order screen: while the order is chosen, every player is shown as just this
 * (their board and stats are hidden, see game-pieces.sass), and tapping it adds them to the order. Hidden the rest of
 * the time. One listener serves local and online play: online, the click is forwarded to the server like any other.
 */
export const orderPick = (): DomItemConfig => ({
  nodeName: 'button',
  attributes: { className: ORDER_PICK_CLASS, type: 'button', disabled: true },
  eventListeners: {
    click: [{ listenerFunc: 'placementListener', listenerArgs: {}, listenerOptions: false }]
  }
})

/**
 * The word for a place in the order: 1st, 2nd, 3rd, then 4th and so on.
 * @param place
 */
export const ordinal = (place: number): string => {
  const suffix = place % 10 === 1 && place % 100 !== 11 ? 'st' : place % 10 === 2 && place % 100 !== 12 ? 'nd' : place % 10 === 3 && place % 100 !== 13 ? 'rd' : 'th'
  return `${place}${suffix}`
}

const update = (item: DomItem, attributes: object): void => {
  treeloom.updateElement(siFunciona.mergeObjectsMutable(item, { attributes }) as DomItem)
}

/**
 * The label above a player's name (or board), which shows their place in the order; '' clears it.
 * @param player
 * @param text
 */
export const setOrderBadge = (player: Player, text: string): void => {
  const badge = treeloom.getChildrenByClass('turn-badge', player as unknown as DomItem)[0]
  if (badge) {
    update(badge, { innerHTML: text })
  }
}

/**
 * Show every player as a name button (shown), or as their board again. A button can be tapped only while
 * `pickable` says so for its player: during Set order, for anyone not yet in the order.
 * @param players
 * @param shown
 * @param pickable
 */
export const showOrderPicks = (players: Player[], shown: boolean, pickable: (player: Player) => boolean = () => false): void => {
  players.forEach(player => {
    const pick = treeloom.getChildrenByClass(ORDER_PICK_CLASS, player as unknown as DomItem)[0]
    if (pick) {
      // textContent, not innerHTML: a name is whatever a player typed
      update(pick, {
        textContent: player.name,
        disabled: !(shown && pickable(player)),
        style: { borderLeftColor: player.colour ?? '' }
      })
    }
    update(player as unknown as DomItem, { 'data-ordering': shown ? 'true' : 'false' })
  })
}
