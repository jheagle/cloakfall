/**
 * @jest-environment jsdom
 */
import { boardToShow, inPlay, initialBarState, installPlayerBar, nextBarState, oneBoardCss, readPlayers } from './playerBar'

const player = (index, overrides = {}) => ({
  index,
  id: `c${index}`,
  name: `P${index + 1}`,
  colour: '',
  status: 100,
  turn: '',
  own: false,
  target: false,
  shots: 0,
  placed: true,
  ...overrides
})

describe('boardToShow', () => {
  test('during my turn: the first target until I choose one', () => {
    const players = [player(0, { own: true, turn: 'attacker' }), player(1, { target: true }), player(2, { target: true })]
    expect(boardToShow(players, initialBarState())).toBe(1)
    expect(boardToShow(players, { ...initialBarState(), chosen: 'c2' })).toBe(2)
  })

  test('during my turn a choice that can no longer be fired at falls back to the first target', () => {
    const players = [player(0, { own: true, turn: 'attacker' }), player(1, { status: 0 }), player(2, { target: true })]
    expect(boardToShow(players, { ...initialBarState(), chosen: 'c1' })).toBe(2)
  })

  test('during my turn the action is not followed: my choice wins', () => {
    const players = [player(0, { own: true, turn: 'attacker' }), player(1, { target: true }), player(2, { target: true })]
    expect(boardToShow(players, { chosen: 'c2', followed: 'c1', shots: {} })).toBe(2)
  })

  test('during someone else\'s turn: the board the latest shot landed on, else my choice, else the first alive', () => {
    const players = [player(0, { own: true }), player(1, { status: 0, turn: '' }), player(2, { turn: 'attacker' }), player(3)]
    expect(boardToShow(players, { chosen: 'c3', followed: 'c2', shots: {} })).toBe(2)
    expect(boardToShow(players, { chosen: 'c3', followed: null, shots: {} })).toBe(3)
    expect(boardToShow(players, initialBarState())).toBe(2)
  })

  test('nothing to choose when there are no other players', () => {
    expect(boardToShow([player(0, { own: true })], initialBarState())).toBeNull()
  })

  test('robots only (no own board): one board at a time all the same', () => {
    const players = [player(0, { turn: 'attacker' }), player(1), player(2)]
    expect(boardToShow(players, initialBarState())).toBe(0)
    expect(boardToShow(players, { chosen: 'c2', followed: null, shots: {} })).toBe(2)
  })
})

test('a choice follows the player, not the position, when the boards are reordered (local multiplayer)', () => {
  const players = [player(0, { id: 'blue', own: true, turn: 'attacker' }), player(1, { id: 'red', target: true }), player(2, { id: 'green', target: true })]
  expect(boardToShow(players, { chosen: 'green', followed: null, shots: {} })).toBe(2)
  const reordered = [player(0, { id: 'green', own: true, turn: 'attacker' }), player(1, { id: 'blue', target: true }), player(2, { id: 'red', target: true })]
  expect(boardToShow(reordered, { chosen: 'red', followed: null, shots: {} })).toBe(2)
})

describe('nextBarState', () => {
  test('follows a new shot on an opponent\'s board when it is not my turn', () => {
    const before = { chosen: 'c3', followed: null, shots: { c0: 0, c1: 4, c2: 2, c3: 1 } }
    const players = [player(0, { own: true }), player(1, { shots: 4, turn: 'attacker' }), player(2, { shots: 3 }), player(3, { shots: 1 })]
    expect(nextBarState(players, before)).toEqual({ chosen: 'c3', followed: 'c2', shots: { c0: 0, c1: 4, c2: 3, c3: 1 } })
  })

  test('a shot on my own board is not followed (my board is always shown)', () => {
    const before = { chosen: null, followed: null, shots: { c0: 2, c1: 0 } }
    const players = [player(0, { own: true, shots: 3 }), player(1, { turn: 'attacker' })]
    expect(nextBarState(players, before).followed).toBeNull()
  })

  test('my own turn clears the followed board', () => {
    const before = { chosen: 'c1', followed: 'c2', shots: { c0: 0, c1: 0, c2: 1 } }
    const players = [player(0, { own: true, turn: 'attacker' }), player(1, { target: true }), player(2, { target: true, shots: 1 })]
    expect(nextBarState(players, before).followed).toBeNull()
  })

  test('the first refresh only records the counts (shots already on the boards are not "new")', () => {
    const players = [player(0, { own: true }), player(1, { shots: 5, turn: 'attacker' }), player(2, { shots: 7 })]
    expect(nextBarState(players, initialBarState()).followed).toBeNull()
  })
})

describe('inPlay', () => {
  test('starts when someone first has the turn', () => {
    expect(inPlay([player(0), player(1, { turn: 'attacker' })])).toBe(true)
    expect(inPlay([player(0), player(1)])).toBe(false)
  })

  test('lasts through the moment between two turns when nobody has the turn', () => {
    expect(inPlay([player(0), player(1)], true)).toBe(true)
  })

  test('ends when someone wins, the boards go, or ships are being placed again', () => {
    expect(inPlay([player(0, { turn: 'winner' }), player(1, { status: 0 })], true)).toBe(false)
    expect(inPlay([], true)).toBe(false)
    expect(inPlay([player(0, { placed: false }), player(1, { placed: false })], true)).toBe(false)
  })
})

describe('oneBoardCss', () => {
  test('hides every other opponent\'s board on a narrow screen, never my own', () => {
    const css = oneBoardCss(2)
    expect(css).toMatch(/@media \(max-width: \d+px\)/)
    expect(css).toContain('.player:not(.role-own):not(:nth-child(3))')
  })

  test('nothing to hide when there is no board to choose', () => {
    expect(oneBoardCss(null)).toBe('')
  })
})

/** A rendered game like the one in <main>: .boards with a .player per entry (role, data-status, data-turn, shots). */
const COLOURS = ['#ff6b6b', '#51cf66', '#4dabf7', '#ffa94d']
const renderGame = (main, players) => {
  main.innerHTML = `<div class="boards">${players.map((p, i) => `
    <div class="player role-${p.role}">
      <div class="turn-badge"></div>
      <div class="matrix">${'<div class="column" data-shot="miss"></div>'.repeat(p.shots ?? 0)}</div>
      <div class="player-stats" data-status="${p.status ?? 100}" data-turn="${p.turn ?? ''}">
        <span class="player-name"><strong style="color: ${COLOURS[i]}">${p.name}</strong>: x</span><ul></ul>
      </div>
    </div>`).join('')}</div>`
}

describe('readPlayers', () => {
  test('reads each player\'s name, colour, status, turn, role and shots from the page', () => {
    const main = document.createElement('main')
    renderGame(main, [
      { role: 'own', name: 'Ann', turn: 'attacker', status: 100 },
      { role: 'target', name: 'Bob', status: 62.5, shots: 3 }
    ])
    expect(readPlayers(main)).toEqual([
      { index: 0, id: 'rgb(255, 107, 107)', name: 'Ann', colour: 'rgb(255, 107, 107)', status: 100, turn: 'attacker', own: true, target: false, shots: 0, placed: true },
      { index: 1, id: 'rgb(81, 207, 102)', name: 'Bob', colour: 'rgb(81, 207, 102)', status: 62.5, turn: '', own: false, target: true, shots: 3, placed: true }
    ])
  })

  test('no boards, no players', () => {
    const main = document.createElement('main')
    main.innerHTML = '<div class="main-menu"></div>'
    expect(readPlayers(main)).toEqual([])
  })
})

describe('installPlayerBar', () => {
  beforeEach(() => {
    // A frame later, as in a browser (never synchronously: the bar sets its pending frame from the return value)
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => setTimeout(() => callback(performance.now()), 0))
  })
  afterEach(() => {
    jest.restoreAllMocks()
    document.body.innerHTML = ''
    document.body.className = ''
  })

  /** Let the scheduled refresh run. */
  const nextFrame = () => new Promise(resolve => setTimeout(resolve, 5))

  const setUp = async players => {
    const main = document.createElement('main')
    main.className = 'game'
    document.body.append(main)
    renderGame(main, players)
    const remove = installPlayerBar(main)
    await nextFrame()
    return { main, remove, nav: document.querySelector('nav.player-bar'), style: main.nextElementSibling.nextElementSibling }
  }

  test('during play: an entry per player, buttons for opponents, the shown one pressed, and a stylesheet showing it', async () => {
    const { nav, style } = await setUp([
      { role: 'own', name: 'Ann', turn: 'attacker' },
      { role: 'target', name: 'Bob' },
      { role: 'target', name: '&lt;b&gt;Cy&lt;/b&gt;' }
    ])
    expect(nav.hidden).toBe(false)
    expect(document.body.classList.contains('has-player-bar')).toBe(true)
    const entries = Array.from(nav.querySelectorAll('.player-bar-entry'))
    expect(entries.map(entry => entry.tagName)).toEqual(['SPAN', 'BUTTON', 'BUTTON'])
    expect(entries[0].textContent).toBe('Ann (you)100%firing')
    // Names are text, never markup
    expect(entries[2].querySelector('.player-bar-name').textContent).toBe('<b>Cy</b>')
    expect(entries.map(entry => entry.getAttribute('aria-pressed'))).toEqual([null, 'true', 'false'])
    expect(style.textContent).toContain(':nth-child(2)')
  })

  test('tapping an opponent shows their board', async () => {
    const { nav, style } = await setUp([
      { role: 'own', name: 'Ann', turn: 'attacker' },
      { role: 'target', name: 'Bob' },
      { role: 'target', name: 'Cy' }
    ])
    nav.querySelectorAll('button')[1].click()
    await nextFrame()
    expect(style.textContent).toContain(':nth-child(3)')
    expect(Array.from(nav.querySelectorAll('button')).map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  test('a turn change updates the entries in place: the same elements, only what changed', async () => {
    const { main, nav } = await setUp([
      { role: 'own', name: 'Ann', turn: 'attacker' },
      { role: 'target', name: 'Bob' }
    ])
    const before = Array.from(nav.querySelectorAll('.player-bar-entry'))
    renderGame(main, [
      { role: 'own', name: 'Ann' },
      { role: 'summary', name: 'Bob', turn: 'attacker', status: 80 }
    ])
    await nextFrame()
    const after = Array.from(nav.querySelectorAll('.player-bar-entry'))
    after.forEach((entry, i) => expect(entry).toBe(before[i]))
    expect(after[1].classList.contains('is-attacker')).toBe(true)
    expect(after[1].querySelector('.player-bar-status').textContent).toBe('80%')
    expect(after[0].querySelector('.player-bar-turn').hidden).toBe(true)
  })

  test('hidden, with no stylesheet, when no one is playing (menu, placement, the end)', async () => {
    const { nav, style } = await setUp([{ role: 'own', name: 'Ann' }, { role: 'summary', name: 'Bob' }])
    expect(nav.hidden).toBe(true)
    expect(style.textContent).toBe('')
    expect(document.body.classList.contains('has-player-bar')).toBe(false)
  })

  test('removing it takes the bar and its stylesheet away', async () => {
    const { remove } = await setUp([{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }])
    remove()
    expect(document.querySelector('nav.player-bar')).toBeNull()
    expect(document.querySelector('style')).toBeNull()
  })
})
