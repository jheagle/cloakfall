/**
 * Which shots are new since the player bar last looked (its refresh, playerBar.ts), so each can be shown as it lands:
 * the struck cell flashes, and the bar marks whose board was shot ("Hit" / "Miss"; on the viewer's own entry too, so
 * a hit on their board is noticed with its drawer closed).
 *
 * Like the bar, this runs outside the game's tree. The flash is a Web Animation on the cell itself rather than a class:
 * an online push sets each cell's classes from the server, which would cut a class-based flash short, but leaves an
 * animation alone.
 */

/** The ship a hit struck, as the hit cell names it (attack/attackFleet.ts's nameHitShip): hits so far, of its size. */
export interface HitShip {
  name: string
  hits: number
  size: number
}

/**
 * A shot that has just landed: on which board (its index among .boards' children), whether it hit a ship, and for a
 * hit, which ship.
 */
export interface NewShot {
  index: number
  result: 'hit' | 'miss'
  cell: HTMLElement
  ship?: HitShip
}

/**
 * The ship a hit cell names, or undefined (a miss, or a cell without the names).
 * @param cell
 */
export const hitShipOf = (cell: HTMLElement): HitShip | undefined => {
  const { ship, shipHits, shipSize } = cell.dataset
  // Number('') is 0, so a missing count must not pass as one: a named hit has struck 1 to size parts
  const hits = Number(shipHits)
  const size = Number(shipSize)
  return ship && Number.isInteger(hits) && Number.isInteger(size) && hits >= 1 && hits <= size ? { name: ship, hits, size } : undefined
}

/** What the bar uses: find the new shots, or start afresh (a new game). */
export interface ShotWatcher {
  scan: (main: Element) => NewShot[]
  reset: () => void
}

/**
 * Track the shot cells already seen. The first scan of a game only records what is there (a game shown part-way
 * through, e.g. an online player arriving, must not flash every old shot at once); every later one returns what is new.
 */
export const createShotWatcher = (): ShotWatcher => {
  let seen = new WeakSet<Element>()
  let seeded = false

  const scan = (main: Element): NewShot[] => {
    const boards = Array.from(main.children).find(child => child.classList.contains('boards'))
    const fresh: NewShot[] = []
    Array.from(boards?.children ?? []).forEach((player, index) => {
      player.querySelectorAll<HTMLElement>('[data-shot]').forEach(cell => {
        if (seen.has(cell)) {
          return
        }
        seen.add(cell)
        if (seeded) {
          const result = cell.dataset.shot === 'hit' ? 'hit' : 'miss'
          const ship = result === 'hit' ? hitShipOf(cell) : undefined
          fresh.push(ship ? { index, result, cell, ship } : { index, result, cell })
        }
      })
    })
    seeded = true
    return fresh
  }

  const reset = (): void => {
    seen = new WeakSet()
    seeded = false
  }

  return { scan, reset }
}

/** How long the struck cell flashes. */
export const FLASH_MS = 900

/**
 * Flash a cell that was just shot: a bright ring that fades, bigger for a hit. With reduced motion, the ring only (no
 * growing). Does nothing where the Web Animations API isn't there.
 * @param shot
 * @param reducedMotion
 */
export const flashShot = (shot: NewShot, reducedMotion: boolean): void => {
  const colour = shot.result === 'hit' ? '255, 138, 61' : '232, 236, 248'
  const ring = `0 0 0 .3rem rgba(${colour}, 1), 0 0 1.4rem .6rem rgba(${colour}, .7)`
  const grow = reducedMotion ? {} : { transform: shot.result === 'hit' ? 'scale(1.35)' : 'scale(1.15)' }
  shot.cell.animate?.([
    { boxShadow: ring, ...grow, zIndex: 2 },
    { boxShadow: `0 0 0 0 rgba(${colour}, 0)`, transform: 'none', zIndex: 2 }
  ], { duration: FLASH_MS, easing: 'ease-out' })
}

export default createShotWatcher
