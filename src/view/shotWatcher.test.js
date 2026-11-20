/**
 * @jest-environment jsdom
 */
import createShotWatcher, { flashShot, hitShipOf } from './shotWatcher'

const mainWith = shotsPerBoard => {
  const main = document.createElement('main')
  main.innerHTML = `<div class="boards">${shotsPerBoard.map(shots => `<div class="player">${shots.map(result => `<div class="column" data-shot="${result}"></div>`).join('')}<div class="column"></div></div>`).join('')}</div>`
  return main
}
const shoot = (main, board, result) => {
  const cell = main.querySelectorAll('.boards > .player')[board].querySelector('.column:not([data-shot])')
  cell.dataset.shot = result
  return cell
}

describe('createShotWatcher', () => {
  test('the first look only records what is there: shots already on the boards are not new', () => {
    const watcher = createShotWatcher()
    expect(watcher.scan(mainWith([['hit', 'miss'], ['miss']]))).toEqual([])
  })

  test('then returns each shot as it lands: which board, hit or miss, and the cell', () => {
    const main = mainWith([[], ['miss']])
    const watcher = createShotWatcher()
    watcher.scan(main)
    const cell = shoot(main, 1, 'hit')
    expect(watcher.scan(main)).toEqual([{ index: 1, result: 'hit', cell }])
    expect(watcher.scan(main)).toEqual([])
  })

  test('reset: a new game starts with a fresh first look', () => {
    const main = mainWith([[]])
    const watcher = createShotWatcher()
    watcher.scan(main)
    watcher.reset()
    shoot(main, 0, 'miss')
    expect(watcher.scan(main)).toEqual([])
  })
})

describe('flashShot', () => {
  test('animates the cell (a ring; growing only without reduced motion)', () => {
    const cell = document.createElement('div')
    cell.animate = jest.fn()
    flashShot({ index: 0, result: 'hit', cell }, false)
    expect(cell.animate.mock.calls[0][0][0].transform).toBe('scale(1.35)')
    flashShot({ index: 0, result: 'hit', cell }, true)
    expect(cell.animate.mock.calls[1][0][0].transform).toBeUndefined()
    expect(cell.animate.mock.calls[1][0][0].boxShadow).toMatch(/rgba/)
  })

  test('does nothing where there is no Web Animations API', () => {
    expect(() => flashShot({ index: 0, result: 'miss', cell: document.createElement('div') }, false)).not.toThrow()
  })
})

describe('hitShipOf (CLOA-22)', () => {
  const cell = data => {
    const element = document.createElement('div')
    Object.entries(data).forEach(([key, value]) => { element.dataset[key] = value })
    return element
  }

  test('reads the ship a hit cell names: name, hits so far, size', () => {
    expect(hitShipOf(cell({ ship: 'Cruiser', shipHits: '1', shipSize: '3' }))).toEqual({ name: 'Cruiser', hits: 1, size: 3 })
    expect(hitShipOf(cell({ ship: 'Scout', shipHits: '2', shipSize: '2' }))).toEqual({ name: 'Scout', hits: 2, size: 2 })
  })

  test('anything incomplete or impossible names no ship (the bar then says just "Hit")', () => {
    expect(hitShipOf(cell({}))).toBeUndefined()
    // A missing count would read as 0 (Number('') is 0): not "Cruiser 0/3"
    expect(hitShipOf(cell({ ship: 'Cruiser', shipSize: '3' }))).toBeUndefined()
    expect(hitShipOf(cell({ ship: 'Cruiser', shipHits: '4', shipSize: '3' }))).toBeUndefined()
    expect(hitShipOf(cell({ ship: 'Cruiser', shipHits: 'x', shipSize: '3' }))).toBeUndefined()
    expect(hitShipOf(cell({ shipHits: '1', shipSize: '3' }))).toBeUndefined()
  })
})
