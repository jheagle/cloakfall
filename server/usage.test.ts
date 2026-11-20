/**
 * @jest-environment node
 */
import { createUsageLog, minutesSince } from './usage'

describe('createUsageLog', () => {
  test('writes one JSON line per event, with the time first, and counts the totals', () => {
    const lines: string[] = []
    const log = createUsageLog(line => lines.push(line), () => Date.UTC(2026, 10, 20, 12))
    log.record('room-created', {})
    log.record('game-started', { humans: 2, robots: 1, hints: 'on', restart: false })
    log.record('game-finished', { humans: 2, robots: 1, minutes: 4.5, turns: 80 })
    log.record('player-left', { during: 'waiting', players: 1 })
    log.record('player-left', { during: 'game', players: 1 })
    expect(lines[0]).toBe('{"time":"2026-11-20T12:00:00.000Z","usage":"room-created"}')
    expect(JSON.parse(lines[2])).toEqual({ time: '2026-11-20T12:00:00.000Z', usage: 'game-finished', humans: 2, robots: 1, minutes: 4.5, turns: 80 })
    expect(log.totals()).toEqual({ roomsCreated: 1, gamesStarted: 1, gamesFinished: 1, gamesStopped: 0, playersLeftMidGame: 1 })
  })

  test('a writer that throws never breaks the caller, and the totals still count', () => {
    const log = createUsageLog(() => { throw new Error('disk full') })
    expect(() => log.record('room-created', {})).not.toThrow()
    expect(log.totals().roomsCreated).toBe(1)
  })

  test('totals are a copy', () => {
    const log = createUsageLog()
    log.totals().roomsCreated = 99
    expect(log.totals().roomsCreated).toBe(0)
  })
})

test('minutesSince rounds to one decimal', () => {
  expect(minutesSince(0, 90000)).toBe(1.5)
  expect(minutesSince(0, 0)).toBe(0)
  expect(minutesSince(0, 61000)).toBe(1)
})
