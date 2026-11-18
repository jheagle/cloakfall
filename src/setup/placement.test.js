/**
 * @jest-environment jsdom
 */

import treeloom from 'treeloom'
import treeloomMatrix from 'treeloom-matrix'
import { useGameLifecycle, startGame, settle, click } from '../../tests/helpers/game'

useGameLifecycle()

describe('the placement phase', () => {
  const setUp = async () => {
    const { players } = startGame({ humans: 2, placing: true })
    await settle()
    return players
  }
  const tile = (player, x, y) => treeloomMatrix.getDomItemFromPoint(treeloomMatrix.point(x, y, 0), player.board)
  const place = async (player, from, to) => {
    await click(tile(player, ...from), 0)
    await click(tile(player, ...to), 0)
  }
  const panel = () => document.querySelector('.placement')
  const message = () => document.querySelector('.placement-message').textContent
  const button = name => document.querySelector(`.${name}`)
  const shown = name => button(name).style.display !== 'none'
  const fleetPlacement = [[[0, 0], [4, 0]], [[0, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 3], [2, 3]], [[0, 4], [1, 4]]]

  test('starts with a handoff for the first player: the others look away, and only Continue is shown', async () => {
    const [first, second] = await setUp()
    expect(message()).toContain('Player 1')
    expect(shown('placement-continue')).toBe(true)
    expect(button('placement-continue').textContent).toBe('Continue')
    expect(button('placement-randomise').textContent).toBe('Randomise')
    expect(button('placement-done').textContent).toBe('Done')
    expect(shown('placement-randomise')).toBe(false)
    expect(first.element.style.display).toBe('none')
    expect(second.element.style.display).toBe('none')
  })

  test('after Continue, the player places ships, and Done waits for every ship', async () => {
    await setUp()
    button('placement-continue').click()
    expect(shown('placement-randomise')).toBe(true)
    expect(button('placement-done').disabled).toBe(true)
    expect(message()).toContain('Mothership')
  })

  test('a valid start and end places the ship; an invalid one is refused', async () => {
    const [first] = await setUp()
    button('placement-continue').click()
    await place(first, [0, 0], [2, 3])
    expect(first.shipFleet).toHaveLength(0)
    expect(message()).toContain('not a valid place for the Mothership')
    await place(first, [0, 0], [4, 0])
    expect(first.shipFleet).toHaveLength(1)
    expect(message()).toContain('Dreadnought')
  })

  test('clicks on the other player\'s board are ignored while this player places', async () => {
    const [first, second] = await setUp()
    button('placement-continue').click()
    await place(second, [0, 0], [4, 0])
    expect(second.shipFleet).toHaveLength(0)
    expect(first.shipFleet).toHaveLength(0)
  })

  test('a full fleet placed by hand, then Done, hands over to the next player', async () => {
    const [first, second] = await setUp()
    button('placement-continue').click()
    for (const [from, to] of fleetPlacement) {
      await place(first, from, to)
    }
    expect(first.shipFleet.map(ship => ship.parts.length)).toEqual([5, 4, 3, 3, 2])
    expect(button('placement-done').disabled).toBe(false)
    button('placement-done').click()
    expect(message()).toContain('Player 2')
    expect(second.element.style.display).toBe('none')
  })

  test('Randomise places the whole fleet at once, and Done is then available', async () => {
    const [first] = await setUp()
    button('placement-continue').click()
    button('placement-randomise').click()
    expect(first.shipFleet.map(ship => ship.parts.length)).toEqual([5, 4, 3, 3, 2])
    expect(button('placement-done').disabled).toBe(false)
  })

  test('Done with ships still to place does nothing', async () => {
    const [first] = await setUp()
    button('placement-continue').click()
    button('placement-done').click()
    expect(panel().style.display).not.toBe('none')
    expect(first.shipFleet).toHaveLength(0)
  })

  test('stats are hidden during placement', async () => {
    const [first, second] = await setUp()
    expect(first.playerStats.element.style.display).toBe('none')
    expect(second.playerStats.element.style.display).toBe('none')
    button('placement-continue').click()
    button('placement-randomise').click()
    expect(first.playerStats.element.style.display).toBe('none')
  })

  test('after the last player is done, everyone is asked to choose who goes first, with the boards shown and no ship showing', async () => {
    const [first, second] = await setUp()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    expect(panel().style.display).not.toBe('none')
    expect(message()).toContain('Choose who goes first')
    expect(first.element.style.display).toBe('')
    expect(second.element.style.display).toBe('')
    expect(shown('begin-order')).toBe(true)
    expect(shown('begin-random')).toBe(true)
    first.shipFleet.forEach(ship => ship.parts.forEach(part => {
      expect(treeloomMatrix.getDomItemFromPoint(part.point, first.board).element.style.backgroundColor).toBe('')
    }))
  })

  test('setting the order by clicking the boards, then Continue, starts the round with the first board clicked going first', async () => {
    const [first, second] = await setUp()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('begin-order').click()
    expect(second.element.getAttribute('data-pickable')).toBe('true')
    tile(second, 0, 0).element.click()
    expect(second.element.textContent).toContain('1st')
    tile(first, 0, 0).element.click()
    expect(first.element.textContent).toContain('2nd')
    expect(message()).toContain('Player 2, then Player 1')
    expect(first.element.getAttribute('data-pickable')).toBe('false')
    button('placement-continue').click()
    expect(panel().style.display).toBe('none')
    expect(first.element.style.display).toBe('')
    expect(second.element.style.display).toBe('')
    expect(second.attacker).toBe(true)
    expect(first.attacker).toBe(false)
    expect(treeloom.getParentsByClass('boards', first)[0].children.map(p => p.name)).toEqual(['Player 2', 'Player 1'])
    expect(Array.from(document.querySelectorAll('.player')).map(panel => panel.querySelector('strong').textContent)).toEqual(['Player 2', 'Player 1'])
    expect(document.querySelectorAll('.player').length).toBe(2)
  })

  describe('the turn-order screen shows names, not boards (CLOA-18)', () => {
    const placeBoth = async () => {
      const players = await setUp()
      for (let i = 0; i < 2; i++) {
        button('placement-continue').click()
        button('placement-randomise').click()
        button('placement-done').click()
      }
      return players
    }
    const pick = player => player.element.querySelector('.order-pick')

    test('choosing: each player is shown by name, and the names can\'t be tapped until Set order', async () => {
      const [first, second] = await placeBoth()
      expect(first.element.getAttribute('data-ordering')).toBe('true')
      expect(second.element.getAttribute('data-ordering')).toBe('true')
      expect(pick(first).textContent).toBe('Player 1')
      expect(pick(second).textContent).toBe('Player 2')
      expect(pick(first).disabled).toBe(true)
      expect(message()).toContain('tapping each player\'s name')
    })

    test('Set order by tapping names: each one tapped can\'t be tapped again, and the first tapped goes first', async () => {
      const [first, second] = await placeBoth()
      button('begin-order').click()
      expect(pick(first).disabled).toBe(false)
      pick(second).click()
      expect(second.element.textContent).toContain('1st')
      expect(pick(second).disabled).toBe(true)
      expect(pick(first).disabled).toBe(false)
      pick(first).click()
      expect(message()).toContain('Player 2, then Player 1')
      button('placement-continue').click()
      expect(second.attacker).toBe(true)
      expect(first.element.getAttribute('data-ordering')).toBe('false')
      expect(second.element.getAttribute('data-ordering')).toBe('false')
    })

    test('a typed name is the one shown on the turn-order screen', async () => {
      const [first] = await setUp()
      document.querySelector('.placement-name').value = 'Ada'
      for (let i = 0; i < 2; i++) {
        button('placement-continue').click()
        button('placement-randomise').click()
        button('placement-done').click()
      }
      expect(pick(first).textContent).toBe('Ada')
    })

    test('a name is shown as text, never as markup', async () => {
      const [first] = await setUp()
      document.querySelector('.placement-name').value = '<b>Bo</b>'
      for (let i = 0; i < 2; i++) {
        button('placement-continue').click()
        button('placement-randomise').click()
        button('placement-done').click()
      }
      expect(pick(first).textContent).toBe('<b>Bo</b>')
      expect(pick(first).querySelector('b')).toBeNull()
    })
  })

  test('once a player is done, their ships are no longer shown', async () => {
    const [first] = await setUp()
    button('placement-continue').click()
    button('placement-randomise').click()
    const partPoint = first.shipFleet[0].parts[0].point
    expect(treeloomMatrix.getDomItemFromPoint(partPoint, first.board).element.style.backgroundColor).not.toBe('')
    button('placement-done').click()
    const shipPoints = first.shipFleet.flatMap(ship => ship.parts.map(part => part.point))
    shipPoints.forEach(point => {
      expect(treeloomMatrix.getDomItemFromPoint(point, first.board).element.style.backgroundColor).toBe('')
    })
  })

  test('after a start is chosen, only the cells where the ship could end are marked, and the message says how to cancel', async () => {
    const [first] = await setUp()
    button('placement-continue').click()
    await click(tile(first, 0, 0), 0)
    const marked = treeloomMatrix.getAllPoints(first.board).filter(p => p.z === 0)
      .filter(p => tile(first, p.x, p.y).element.className.includes('valid-end')).map(p => `${p.x},${p.y}`)
    expect(marked.sort()).toEqual(['0,4', '4,0'])
    expect(message()).toContain('Click the start again to cancel')
  })

  test('clicking the start again cancels, and the marks go', async () => {
    const [first] = await setUp()
    button('placement-continue').click()
    await click(tile(first, 0, 0), 0)
    await click(tile(first, 0, 0), 0)
    const marked = treeloomMatrix.getAllPoints(first.board).filter(p => p.z === 0)
      .filter(p => tile(first, p.x, p.y).element.className.includes('valid-end'))
    expect(marked).toHaveLength(0)
    expect(first.shipFleet).toHaveLength(0)
  })

  test('Random animates over the players, then chooses a full order, and Continue starts the round with its first player', async () => {
    const [first, second] = await setUp()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('begin-random').click()
    expect(message()).toContain('Choosing at random')
    await settle(3000)
    expect(message()).toContain('will take turns, in that order')
    expect(message()).toContain('Player 1')
    expect(message()).toContain('Player 2')
    button('placement-continue').click()
    expect(first.attacker !== second.attacker).toBe(true)
  })

  test('a single player places straight away: no handoff, and the round starts when they are done', async () => {
    const { players: [human] } = startGame({ humans: 1, robots: 1, placing: true })
    await settle()
    expect(shown('placement-continue')).toBe(false)
    expect(shown('placement-randomise')).toBe(true)
    button('placement-randomise').click()
    button('placement-done').click()
    expect(panel().style.display).toBe('none')
    expect(human.element.style.display).toBe('')
  })

  test('hot-seat: a name typed on the handoff screen is kept, and shown in the stats; placing has no name field', async () => {
    const [first] = await setUp()
    expect(document.querySelector('.placement-name').value).toBe('Player 1')
    expect(shown('placement-name')).toBe(true)
    document.querySelector('.placement-name').value = 'Ada'
    button('placement-continue').click()
    expect(shown('placement-name')).toBe(false)
    button('placement-randomise').click()
    button('placement-done').click()
    expect(first.name).toBe('Ada')
    expect(first.playerStats.element.textContent).toContain('Ada')
  })

  test('an empty name keeps the default', async () => {
    const [first] = await setUp()
    document.querySelector('.placement-name').value = '   '
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    expect(first.name).toBe('Player 1')
  })

  test('the order shows above each board, as 1st, then 2nd', async () => {
    const [first, second] = await setUp()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('placement-continue').click()
    button('placement-randomise').click()
    button('placement-done').click()
    button('begin-order').click()
    tile(second, 0, 0).element.click()
    tile(first, 0, 0).element.click()
    expect(treeloom.getChildrenByClass('turn-badge', second)[0].element.textContent).toBe('1st')
    expect(treeloom.getChildrenByClass('turn-badge', first)[0].element.textContent).toBe('2nd')
  })
})
