/**
 * @jest-environment jsdom
 */
import { useGameLifecycle, startGame, settle, unhitWaterCells } from '../../tests/helpers/game'
import getAttackLock from './attackLock'
import { HIT_PAUSE_MS } from './updateScore'

useGameLifecycle()

const shotsOn = player => player.board.children[0].children.flatMap(row => row.children).filter(cell => cell.isHit).length

describe('the pause after a shot, before the turn passes', () => {
  test('local multiplayer: the shot\'s result stays in view, and nothing else can be fired meanwhile', async () => {
    const { players: [p1, p2] } = startGame({ humans: 2, firstGoesFirst: true })
    await settle()
    getAttackLock(p1).isLocked = false
    unhitWaterCells(p2)[0].element.click()
    await settle(100)
    // A second shot during the pause is refused
    unhitWaterCells(p2)[0].element.click()
    await settle(100)
    expect(shotsOn(p2)).toBe(1)
    expect(p1.attacker).toBe(true)
    await settle(HIT_PAUSE_MS)
    expect(p2.attacker).toBe(true)
    expect(p1.attacker).toBe(false)
  })

  test('single player keeps its pace: the turn passes at once (the robot takes its own time to fire)', async () => {
    const { players: [human, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    getAttackLock(human).isLocked = false
    unhitWaterCells(robot)[0].element.click()
    await settle(50)
    expect(human.attacker).toBe(false)
    expect(robot.attacker).toBe(true)
  })
})
