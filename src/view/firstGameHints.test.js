/**
 * @jest-environment jsdom
 */
import createFirstGameHints, { HINTS_SEEN_KEY, hintLines } from './firstGameHints'

const player = (name, overrides = {}) => ({ index: 0, id: name, name, colour: '', status: 100, turn: '', own: false, target: false, shots: 0, placed: true, ...overrides })

/** A store in memory, like localStorage. */
const memoryStore = (initial = {}) => {
  const items = { ...initial }
  return { items, getItem: key => items[key] ?? null, setItem: (key, value) => { items[key] = String(value) } }
}

const myTurn = [player('Ann', { own: true, turn: 'attacker' }), player('Bob', { target: true }), player('Cat', { target: true })]
const theirTurn = [player('Ann', { own: true }), player('Bob', { turn: 'attacker' })]

describe('hintLines', () => {
  test('with several opponents: how to choose one; with an own board: how to see it', () => {
    expect(hintLines(myTurn)).toEqual([
      'Tap a square on an opponent\'s board to fire.',
      'You have 2 opponents: tap a name in the bar at the bottom to choose whose board to fire at.',
      'Tap your own name (you) in the bar to see your fleet.',
      'Open the menu (☰) for your controls, like the sensor scan when the game has it, and to restart or quit.'
    ])
  })

  test('one opponent left (others out): no choosing; robots only: no own fleet', () => {
    const lines = hintLines([player('Ann', { own: true }), player('Bob'), player('Cat', { status: 0 })])
    expect(lines.some(line => line.includes('opponents'))).toBe(false)
    expect(hintLines([player('Robot 1'), player('Robot 2')]).some(line => line.includes('your fleet'))).toBe(false)
  })
})

describe('createFirstGameHints', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const setUp = store => {
    const hints = createFirstGameHints(document, store)
    document.body.append(hints.element)
    return hints
  }

  test('opens on the viewer\'s first turn, not on someone else\'s; "Got it" closes it and remembers', () => {
    const store = memoryStore()
    const hints = setUp(store)
    hints.update(theirTurn, true)
    expect(hints.isOpen()).toBe(false)
    hints.update(myTurn, true)
    expect(hints.isOpen()).toBe(true)
    expect(hints.element.getAttribute('role')).toBe('dialog')
    expect(hints.element.querySelectorAll('li')).toHaveLength(4)
    const done = hints.element.querySelector('.first-game-hints-done')
    expect(document.activeElement).toBe(done)
    done.click()
    expect(hints.isOpen()).toBe(false)
    expect(store.items[HINTS_SEEN_KEY]).toBe('1')
    // The next turn doesn't bring it back
    hints.update(myTurn, true)
    expect(hints.isOpen()).toBe(false)
  })

  test('seen before on this device: not opened, but the menu can still open it', () => {
    const hints = setUp(memoryStore({ [HINTS_SEEN_KEY]: '1' }))
    hints.update(myTurn, true)
    expect(hints.isOpen()).toBe(false)
    hints.open(myTurn)
    expect(hints.isOpen()).toBe(true)
  })

  test('Escape closes it; the end of play hides it', () => {
    const hints = setUp(memoryStore())
    hints.update(myTurn, true)
    hints.element.querySelector('button').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(hints.isOpen()).toBe(false)
    hints.open(myTurn)
    hints.update(myTurn, false)
    expect(hints.isOpen()).toBe(false)
  })

  test('storage that throws (private mode): shown once per visit, and nothing breaks', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const hints = setUp(broken)
    hints.update(myTurn, true)
    expect(hints.isOpen()).toBe(true)
    hints.close()
    hints.update(myTurn, true)
    expect(hints.isOpen()).toBe(false)
  })
})
