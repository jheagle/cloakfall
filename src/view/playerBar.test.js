/**
 * @jest-environment jsdom
 */
import { OWN_BOARD_EVENT, SHOT_ALERT_MS, boardToShow, inPlay, initialBarState, installPlayerBar, nextBarState, oneBoardCss, PHONE_MEDIA, readPlayers } from './playerBar'

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
  test('hides every other opponent\'s board on a phone, never my own', () => {
    const css = oneBoardCss(2)
    expect(css).toContain(`@media ${PHONE_MEDIA}`)
    expect(css).toContain('.player:not(.role-own):not(:nth-child(3))')
  })

  test('a phone held sideways (short, however wide) gets the phone layout too', () => {
    expect(PHONE_MEDIA).toBe('(max-width: 759px), (max-height: 500px)')
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
  // Frames asked for and not yet run: nextFrame waits for all of them, including a frame that a refresh's own DOM
  // changes ask for (the MutationObserver schedules again)
  const pendingFrames = new Set()
  beforeEach(() => {
    pendingFrames.clear()
    // A frame later, as in a browser (never synchronously: the bar sets its pending frame from the return value)
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = setTimeout(() => {
        pendingFrames.delete(id)
        callback(performance.now())
      }, 0)
      pendingFrames.add(id)
      return id
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
      pendingFrames.delete(id)
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    removeBar?.()
    removeBar = null
    document.body.innerHTML = ''
    document.body.className = ''
  })

  let removeBar = null

  /**
   * Let the scheduled refresh run, and any frame it leads to. A single fixed wait was flaky under load (CLOA-26): a
   * refresh that changes the page schedules another frame, and when the machine stalled, the wait ran out before it.
   */
  const nextFrame = async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 5))
    await tick()
    for (let rounds = 0; pendingFrames.size > 0 && rounds < 100; rounds++) {
      await tick()
    }
  }

  const setUp = async players => {
    const main = document.createElement('main')
    main.className = 'game'
    document.body.append(main)
    renderGame(main, players)
    const remove = installPlayerBar(main)
    removeBar = remove
    await nextFrame()
    return { main, remove, nav: document.querySelector('nav.player-bar'), style: document.querySelector('nav.player-bar ~ style') }
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
    expect(entries.map(entry => entry.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
    expect(entries[0].textContent).toBe('Ann (you)100%firing')
    // Names are text, never markup
    expect(entries[2].querySelector('.player-bar-name').textContent).toBe('<b>Cy</b>')
    expect(entries.map(entry => entry.getAttribute('aria-pressed'))).toEqual([null, 'true', 'false'])
    // No drawer on a wide screen (this DOM has no matchMedia): the own entry isn't a disclosure there
    expect(entries[0].hasAttribute('aria-expanded')).toBe(false)
    expect(style.textContent).toContain(':nth-child(2)')
  })

  test('tapping an opponent shows their board', async () => {
    const { nav, style } = await setUp([
      { role: 'own', name: 'Ann', turn: 'attacker' },
      { role: 'target', name: 'Bob' },
      { role: 'target', name: 'Cy' }
    ])
    nav.querySelectorAll('.player-bar-entry')[2].click()
    await nextFrame()
    expect(style.textContent).toContain(':nth-child(3)')
    expect(Array.from(nav.querySelectorAll('.player-bar-entry')).map(button => button.getAttribute('aria-pressed'))).toEqual([null, 'false', 'true'])
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

  describe('on a phone: the own board\'s drawer', () => {
    beforeEach(() => {
      window.matchMedia = jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }))
    })
    afterEach(() => {
      delete window.matchMedia
    })

    const game = [{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }]
    const ownEntry = nav => nav.querySelector('.player-bar-entry.is-own')
    const isOpen = () => document.body.classList.contains('own-board-open')

    test('the own entry opens and closes it, saying so (aria-expanded)', async () => {
      const { nav } = await setUp(game)
      expect(ownEntry(nav).getAttribute('aria-expanded')).toBe('false')
      ownEntry(nav).click()
      await nextFrame()
      expect(isOpen()).toBe(true)
      expect(ownEntry(nav).getAttribute('aria-expanded')).toBe('true')
      ownEntry(nav).click()
      await nextFrame()
      expect(isOpen()).toBe(false)
      expect(ownEntry(nav).getAttribute('aria-expanded')).toBe('false')
    })

    test('tells the game the own board is open only while the drawer is', async () => {
      const told = []
      document.addEventListener(OWN_BOARD_EVENT, event => told.push(event.detail.open), true)
      const { nav } = await setUp(game)
      ownEntry(nav).click()
      await nextFrame()
      ownEntry(nav).click()
      await nextFrame()
      expect(told).toEqual([false, true, false])
    })

    test('Escape closes it and puts focus back on the own entry', async () => {
      const { nav } = await setUp(game)
      ownEntry(nav).click()
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
      await nextFrame()
      expect(isOpen()).toBe(false)
      expect(document.activeElement).toBe(ownEntry(nav))
    })

    test('a tap outside it only closes it: it never reaches the board underneath (no shot)', async () => {
      const { main, nav } = await setUp(game)
      const cell = main.querySelector('.role-target .matrix')
      const shot = jest.fn()
      cell.addEventListener('click', shot)
      ownEntry(nav).click()
      cell.click()
      expect(isOpen()).toBe(false)
      expect(shot).not.toHaveBeenCalled()
      // closed: taps reach the board again
      cell.click()
      expect(shot).toHaveBeenCalledTimes(1)
    })

    test('taps inside it (its controls) and on the bar leave it open', async () => {
      const { main, nav } = await setUp(game)
      ownEntry(nav).click()
      main.querySelector('.role-own .matrix').click()
      nav.querySelectorAll('.player-bar-entry')[1].click()
      expect(isOpen()).toBe(true)
    })

    test('it closes when the board it shows stops being the viewer\'s (local multiplayer: the next turn)', async () => {
      const { main, nav } = await setUp(game)
      ownEntry(nav).click()
      expect(isOpen()).toBe(true)
      renderGame(main, [{ role: 'target', name: 'Ann' }, { role: 'own', name: 'Bob', turn: 'attacker' }])
      await nextFrame()
      expect(isOpen()).toBe(false)
    })

    test('it closes when the game ends', async () => {
      const { main, nav } = await setUp(game)
      ownEntry(nav).click()
      renderGame(main, [{ role: 'own', name: 'Ann', turn: 'winner' }, { role: 'summary', name: 'Bob', status: 0 }])
      await nextFrame()
      expect(isOpen()).toBe(false)
      expect(document.body.classList.contains('has-own-board')).toBe(false)
    })
  })

  describe('the ☰ menu', () => {
    const game = [{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }]
    const menuButton = nav => nav.querySelector('.player-bar-menu')
    const panel = nav => nav.querySelector('.player-bar-panel')

    test('is at the end of the bar, and opens its panel', async () => {
      const { nav } = await setUp(game)
      expect(nav.lastElementChild).toBe(menuButton(nav))
      menuButton(nav).click()
      expect(panel(nav).hidden).toBe(false)
    })

    test('Escape closes it and puts focus back on the ☰ button', async () => {
      const { nav } = await setUp(game)
      menuButton(nav).click()
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
      expect(panel(nav).hidden).toBe(true)
      expect(document.activeElement).toBe(menuButton(nav))
    })

    test('a tap outside only closes it: it never reaches the board underneath', async () => {
      const { main, nav } = await setUp(game)
      const board = main.querySelector('.role-target .matrix')
      const shot = jest.fn()
      board.addEventListener('click', shot)
      menuButton(nav).click()
      board.click()
      expect(panel(nav).hidden).toBe(true)
      expect(shot).not.toHaveBeenCalled()
    })

    test('closes when the game ends', async () => {
      const { main, nav } = await setUp(game)
      menuButton(nav).click()
      renderGame(main, [{ role: 'own', name: 'Ann', turn: 'winner' }, { role: 'summary', name: 'Bob', status: 0 }])
      await nextFrame()
      expect(panel(nav).hidden).toBe(true)
    })
  })

  test('tells the game when the own board is open (OWN_BOARD_EVENT): a docked board on a wide screen is', async () => {
    const told = []
    const main = document.createElement('main')
    main.addEventListener(OWN_BOARD_EVENT, event => told.push(event.detail.open))
    main.className = 'game'
    document.body.append(main)
    renderGame(main, [{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }])
    removeBar = installPlayerBar(main)
    await nextFrame()
    expect(told).toEqual([true])
    // The next player's turn (local multiplayer): told afresh for their board
    renderGame(main, [{ role: 'target', name: 'Ann' }, { role: 'own', name: 'Bob', turn: 'attacker' }])
    await nextFrame()
    expect(told).toEqual([true, true])
    // The game ends: closed
    renderGame(main, [{ role: 'own', name: 'Ann', turn: 'winner' }, { role: 'summary', name: 'Bob', status: 0 }])
    await nextFrame()
    expect(told).toEqual([true, true, false])
  })

  describe('shots as they land', () => {
    const shoot = (main, board, result, ship) => {
      const matrix = main.querySelectorAll('.boards > .player')[board].querySelector('.matrix')
      const cell = document.createElement('div')
      cell.className = 'column'
      cell.dataset.shot = result
      if (ship) {
        // What attackFleet's nameHitShip puts on a hit cell
        cell.dataset.ship = ship.name
        cell.dataset.shipHits = String(ship.hits)
        cell.dataset.shipSize = String(ship.size)
      }
      matrix.append(cell)
      return cell
    }

    test('a hit names the ship and its hits so far; the hit that sinks it says so (CLOA-22)', async () => {
      const { main, nav } = await setUp([{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }])
      const bob = () => nav.querySelectorAll('.player-bar-entry')[1].querySelector('.player-bar-alert').textContent
      shoot(main, 1, 'hit', { name: 'Cruiser', hits: 1, size: 3 })
      await nextFrame()
      expect(bob()).toBe('Hit: Cruiser 1/3')
      shoot(main, 1, 'hit', { name: 'Cruiser', hits: 3, size: 3 })
      await nextFrame()
      expect(bob()).toBe('Sunk: Cruiser')
    })

    test('a hit on the viewer\'s own fleet is announced with the ship (CLOA-22)', async () => {
      const { main, nav } = await setUp([{ role: 'own', name: 'Ann' }, { role: 'target', name: 'Bob', turn: 'attacker' }])
      const announced = () => nav.querySelector('.player-bar-announcer').textContent
      shoot(main, 0, 'hit', { name: 'Dreadnought', hits: 2, size: 4 })
      await nextFrame()
      expect(announced()).toBe('Your Dreadnought was hit, 2 of 4')
      shoot(main, 0, 'hit', { name: 'Scout', hits: 2, size: 2 })
      await nextFrame()
      expect(announced()).toBe('Your Scout was sunk')
    })

    test('the struck player\'s entry says "Hit" or "Miss" for a moment, then goes back', async () => {
      const { main, nav } = await setUp([{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }])
      shoot(main, 1, 'hit')
      await nextFrame()
      const bob = nav.querySelectorAll('.player-bar-entry')[1]
      expect(bob.classList.contains('was-hit')).toBe(true)
      expect(bob.querySelector('.player-bar-alert').textContent).toBe('Hit')
      await new Promise(resolve => setTimeout(resolve, SHOT_ALERT_MS + 50))
      await nextFrame()
      expect(bob.classList.contains('was-hit')).toBe(false)
      expect(bob.querySelector('.player-bar-alert').textContent).toBe('')
    }, SHOT_ALERT_MS + 5000)

    test('a shot on the viewer\'s own board is announced (it may be out of sight in the drawer)', async () => {
      const { main, nav } = await setUp([{ role: 'own', name: 'Ann' }, { role: 'target', name: 'Bob', turn: 'attacker' }])
      shoot(main, 0, 'hit')
      await nextFrame()
      expect(nav.querySelector('.player-bar-announcer').textContent).toBe('Your fleet was hit')
      expect(nav.querySelector('.player-bar-entry.is-own').classList.contains('was-hit')).toBe(true)
      shoot(main, 0, 'miss')
      await nextFrame()
      expect(nav.querySelector('.player-bar-announcer').textContent).toBe('A shot missed your fleet')
    })

    test('shots already there when the game comes into view are not new', async () => {
      const main = document.createElement('main')
      main.className = 'game'
      document.body.append(main)
      renderGame(main, [{ role: 'own', name: 'Ann', turn: 'attacker', shots: 3 }, { role: 'target', name: 'Bob', shots: 4 }])
      removeBar = installPlayerBar(main)
      await nextFrame()
      expect(document.querySelectorAll('.was-hit, .was-missed')).toHaveLength(0)
      expect(document.querySelector('.player-bar-announcer').textContent).toBe('')
    })
  })

  test('has-own-board while playing with an own board (wide screens dock it apart), not in robots only', async () => {
    const { main } = await setUp([{ role: 'own', name: 'Ann', turn: 'attacker' }, { role: 'target', name: 'Bob' }])
    expect(document.body.classList.contains('has-own-board')).toBe(true)
    renderGame(main, [{ role: 'summary', name: 'R1', turn: 'attacker' }, { role: 'summary', name: 'R2' }])
    await nextFrame()
    expect(document.body.classList.contains('has-own-board')).toBe(false)
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
    removeBar = null
    expect(document.querySelector('nav.player-bar')).toBeNull()
    expect(document.querySelector('style')).toBeNull()
  })
})
