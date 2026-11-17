/**
 * @jest-environment jsdom
 */
import treeloomMatrix from 'treeloom-matrix'
import { useGameLifecycle, startGame, settle } from '../../tests/helpers/game'
import { OWN_BOARD_EVENT } from '../view/playerBar'

useGameLifecycle()

describe('local multiplayer: your ships show while your own board is open', () => {
  const shaded = player => player.shipFleet
    .flatMap(ship => ship.parts.map(part => treeloomMatrix.getDomItemFromPoint(part.point, player.board)))
    .filter(tile => !tile.isHit)
    .every(tile => tile.element.style.backgroundColor !== '')
  const anyShaded = player => player.shipFleet
    .flatMap(ship => ship.parts.map(part => treeloomMatrix.getDomItemFromPoint(part.point, player.board)))
    .some(tile => !tile.isHit && tile.element.style.backgroundColor !== '')
  const tell = (doc, open) => doc.body.element.dispatchEvent(new CustomEvent(OWN_BOARD_EVENT, { detail: { open } }))

  test('open: the current player\'s ships show, nobody else\'s; closed: hidden again', async () => {
    const { doc, players } = startGame({ humans: 2 })
    await settle()
    const own = players.find(player => player.attributes.className.includes('role-own'))
    const other = players.find(player => player !== own)
    expect(anyShaded(own)).toBe(false)
    tell(doc, true)
    expect(shaded(own)).toBe(true)
    expect(anyShaded(other)).toBe(false)
    tell(doc, false)
    expect(anyShaded(own)).toBe(false)
  })

  test('single player ignores it: the human\'s ships always show', async () => {
    const { doc, players: [human] } = startGame({ humans: 1, robots: 1 })
    await settle()
    tell(doc, false)
    expect(shaded(human)).toBe(true)
  })
})
