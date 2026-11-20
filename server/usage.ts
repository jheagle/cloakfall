/**
 * The lobby's usage log: one JSON line per event (rooms, games, players leaving), to see how online games are played
 * and what to fix. Counts and settings only: never a name, a room code or a network address. Each line goes to the
 * given writer (the server passes console.log, so it ends up in the container's log); the totals since the server
 * started are shown on GET /status.
 */

/** What can happen, and the fields each event carries. */
export interface UsageEvents {
  'room-created': Record<string, never>
  'room-joined': { players: number }
  'room-closed': { reason: 'host-left' | 'idle', players: number, games: number, minutes: number }
  'game-started': { humans: number, robots: number, hints: string, restart: boolean }
  'game-finished': { humans: number, robots: number, minutes: number, turns: number }
  'game-stopped': { reason: 'restart' | 'lobby' | 'host-left' | 'idle', humans: number, robots: number, minutes: number }
  'player-left': { during: 'waiting' | 'game', players: number }
}

export type UsageEvent = keyof UsageEvents

/** Counts since the server started, for /status. */
export interface UsageTotals {
  roomsCreated: number
  gamesStarted: number
  gamesFinished: number
  gamesStopped: number
  playersLeftMidGame: number
}

export interface UsageLog {
  /** Write one event (and count it). */
  record: <E extends UsageEvent>(event: E, fields: UsageEvents[E]) => void
  totals: () => UsageTotals
}

/**
 * Minutes between two Date.now() times, to one decimal.
 * @param since
 * @param now
 */
export const minutesSince = (since: number, now: number): number => Math.round((now - since) / 6000) / 10

/**
 * @param write where each line goes; nothing is written without one (the tests and other embedders)
 * @param now the clock, for tests
 */
export const createUsageLog = (write?: (line: string) => void, now: () => number = Date.now): UsageLog => {
  const totals: UsageTotals = { roomsCreated: 0, gamesStarted: 0, gamesFinished: 0, gamesStopped: 0, playersLeftMidGame: 0 }
  const counted: Partial<Record<UsageEvent, keyof UsageTotals>> = {
    'room-created': 'roomsCreated',
    'game-started': 'gamesStarted',
    'game-finished': 'gamesFinished',
    'game-stopped': 'gamesStopped'
  }
  return {
    record: (event, fields) => {
      const total = counted[event]
      if (total) {
        totals[total] += 1
      }
      if (event === 'player-left' && (fields as UsageEvents['player-left']).during === 'game') {
        totals.playersLeftMidGame += 1
      }
      try {
        write?.(JSON.stringify({ time: new Date(now()).toISOString(), usage: event, ...fields }))
      } catch {
        // Logging must never take the lobby down
      }
    },
    totals: () => ({ ...totals })
  }
}
