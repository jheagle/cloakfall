/**
 * @jest-environment jsdom
 */

import { useGameLifecycle, startGame, settle, click, unhitWaterCells } from '../../tests/helpers/game'
import getAttackLock from './attackLock'

useGameLifecycle()

describe('telling the players apart', () => {
  test('each player gets their own colour', async () => {
    const { players } = startGame({ humans: 4, placing: false })
    await settle()
    const colours = players.map(player => player.colour)
    expect(new Set(colours).size).toBe(4)
    colours.forEach(colour => expect(colour).toMatch(/^#/))
  })

  test('only the player whose turn it is is highlighted: the boards they can attack are not marked', async () => {
    const { players: [human, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    expect(human.attacker).toBe(true)
    expect(human.element.style.outline).toMatch(/yellow/)
    expect(robot.element.style.outline).not.toMatch(/yellow/)
    expect(robot.element.style.boxShadow).toBe('')
  })

  test('when the turn passes, the outline moves to the next attacker', async () => {
    const { players: [human, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    getAttackLock(robot).isLocked = false
    await click(unhitWaterCells(robot)[0], 100)
    expect(human.attacker).toBe(false)
    expect(human.element.style.outline).toBe('none')
    expect(robot.element.style.outline).toMatch(/yellow/)
  })
})
