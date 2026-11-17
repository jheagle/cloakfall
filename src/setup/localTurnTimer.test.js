/**
 * @jest-environment jsdom
 */
import { useGameLifecycle, startGame, settle } from '../../tests/helpers/game'
import { LOCAL_TURN_MS, setLocalTurnTimer } from './localTurnTimer'
import { stopGame } from './gameSession'
import { TURN_DEADLINE_EVENT } from '../view/turnBanner'

useGameLifecycle()

const shotsOn = player => player.board.children[0].children.flatMap(row => row.children).filter(cell => cell.isHit).length

describe('the local turn timer', () => {
  let told
  const listen = event => told.push(event.detail.deadline)
  beforeEach(() => {
    told = []
    document.addEventListener(TURN_DEADLINE_EVENT, listen)
  })
  afterEach(() => document.removeEventListener(TURN_DEADLINE_EVENT, listen))

  test('off (the default): a human can take as long as they like', async () => {
    const { players: [human, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    expect(human.attacker).toBe(true)
    await settle(LOCAL_TURN_MS * 2)
    expect(human.attacker).toBe(true)
    expect(shotsOn(robot)).toBe(0)
  })

  test('on: the banner is told the deadline, and when it runs out a random shot is fired for the human', async () => {
    const { doc, players: [human, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    setLocalTurnTimer(doc, true)
    expect(told[told.length - 1]).toBeGreaterThan(Date.now())
    await settle(LOCAL_TURN_MS - 1000)
    expect(shotsOn(robot)).toBe(0)
    await settle(1500)
    expect(shotsOn(robot)).toBe(1)
    // The robot's turn has no limit
    await settle(200)
    expect(human.attacker).toBe(false)
    expect(told).toContain(null)
  })

  test('local multiplayer: every human\'s turn gets a fresh clock', async () => {
    const { doc, players: [first, second] } = startGame({ humans: 2 })
    await settle()
    setLocalTurnTimer(doc, true)
    const attacker = [first, second].find(player => player.attacker)
    const other = attacker === first ? second : first
    await settle(LOCAL_TURN_MS + 500)
    expect(shotsOn(other)).toBe(1)
    await settle(1000)
    expect(other.attacker).toBe(true)
    await settle(LOCAL_TURN_MS + 500)
    expect(shotsOn(attacker)).toBe(1)
  })

  test('a game stopped mid-turn (quit, restart) never fires the shot', async () => {
    const { doc, players: [, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    setLocalTurnTimer(doc, true)
    stopGame(doc)
    await settle(LOCAL_TURN_MS * 2)
    expect(shotsOn(robot)).toBe(0)
  })

  test('switched off mid-turn: the clock stops, and the banner shows no limit', async () => {
    const { doc, players: [, robot] } = startGame({ humans: 1, robots: 1, firstGoesFirst: true })
    await settle()
    setLocalTurnTimer(doc, true)
    setLocalTurnTimer(doc, false)
    expect(told[told.length - 1]).toBeNull()
    await settle(LOCAL_TURN_MS * 2)
    expect(shotsOn(robot)).toBe(0)
  })
})
