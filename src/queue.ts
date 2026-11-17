import { getSession } from './setup/gameSession'
import type { DomItem } from 'treeloom/dist/domItem/types'

/**
 * The timed queue the given item's game runs on: steps queued here run one after another, after their delay. Each
 * game has its own queue (see gameSession), so two games' turn changes, robot attacks, and animations never interleave,
 * and a step queued for a game that has since been stopped is skipped.
 * @param item
 * @param fn
 * @param time
 * @param args
 */
const queueTimeout = (item: DomItem, fn: Function, time: number = 0, ...args: any[]): Promise<any> => {
  const session = getSession(item)
  const generation = session.generation
  // Skipped if the game it was queued for has been stopped since (quit, or restarted: see gameSession's stopGame)
  return session.queue((...stepArgs: any[]) => session.generation === generation ? fn(...stepArgs) : undefined, time, ...args)
}

export default queueTimeout
