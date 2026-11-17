/**
 * @jest-environment jsdom
 */

import treeloomMatrix from 'treeloom-matrix'
import { useGameLifecycle, startGame, settle } from '../../tests/helpers/game'

useGameLifecycle()

describe('showing ships during play', () => {
  // The parts not yet hit: a hit cell is coloured by the hit, and robots may already have hit some
  const shipElements = player => player.shipFleet
    .flatMap(ship => ship.parts.map(part => treeloomMatrix.getDomItemFromPoint(part.point, player.board)))
    .filter(tile => !tile.isHit)
    .map(tile => tile.element)
  const shaded = element => element.style.backgroundColor !== ''
  const toggle = (selector, checked) => {
    const input = document.querySelector(selector)
    input.checked = checked
    input.dispatchEvent(new Event('change'))
  }

  test('one-player game: the human\'s own ships always show, the robots\' never do, and there is no checkbox', async () => {
    const { players: [human, robot] } = startGame({ humans: 1, robots: 1 })
    await settle()
    expect(human.showShips).toBe(true)
    expect(shipElements(human).every(shaded)).toBe(true)
    expect(shipElements(robot).some(shaded)).toBe(false)
    expect(document.querySelector('.own-ships')).toBeNull()
  })

  test('a ship which has been hit keeps its colour when the ships are shown or hidden', async () => {
    const { players } = startGame({ humans: 0, robots: 2 })
    await settle()
    const robot = players[0]
    const part = robot.shipFleet[0].parts[0]
    treeloomMatrix.getDomItemFromPoint(part.point, robot.board).isHit = true
    treeloomMatrix.getDomItemFromPoint(part.point, robot.board).element.style.backgroundColor = 'red'
    toggle('.all-ships', true)
    expect(treeloomMatrix.getDomItemFromPoint(part.point, robot.board).element.style.backgroundColor).toBe('red')
    toggle('.all-ships', false)
    expect(treeloomMatrix.getDomItemFromPoint(part.point, robot.board).element.style.backgroundColor).toBe('red')
  })

  test('multiplayer has no own-ships checkbox', async () => {
    startGame({ humans: 2 })
    await settle()
    expect(document.querySelector('.own-ships')).toBeNull()
  })

  test('robots-only game: one control shows every ship on every board, and hides them again', async () => {
    const { players } = startGame({ humans: 0, robots: 2 })
    await settle()
    expect(document.querySelectorAll('.all-ships')).toHaveLength(1)
    expect(players.some(p => shipElements(p).some(shaded))).toBe(false)
    toggle('.all-ships', true)
    players.forEach(p => expect(shipElements(p).every(shaded)).toBe(true))
    toggle('.all-ships', false)
    players.forEach(p => expect(shipElements(p).some(shaded)).toBe(false))
  })
})
