/**
 * @jest-environment jsdom
 */
import createControlPanel, { GAME_ACTION_EVENT, GAME_ACTIONS_QUERY } from './controlPanel'

describe('createControlPanel', () => {
  /** A <main> with the controls the game would render: the viewer's own sensor-scan box and/or robots-only's. */
  const mainWith = ({ hint = false, allShips = false } = {}) => {
    const main = document.createElement('main')
    main.innerHTML = `
      ${allShips ? '<label class="ships-control"><input class="all-ships" type="checkbox"></label>' : ''}
      <div class="boards">
        <div class="player role-own"><div class="player-stats">${hint ? '<div class="player-controls"><label><input type="checkbox"></label></div>' : ''}</div></div>
        <div class="player role-target"><div class="player-stats"><div class="player-controls"><label><input type="checkbox" class="theirs"></label></div></div></div>
      </div>`
    return main
  }
  const switches = menu => Array.from(menu.panel.querySelectorAll('.player-bar-control'))

  test('the ☰ button opens and closes the panel, saying so (aria-expanded)', () => {
    const menu = createControlPanel(mainWith({ hint: true }))
    expect(menu.panel.hidden).toBe(true)
    expect(menu.button.getAttribute('aria-controls')).toBe(menu.panel.id)
    menu.button.click()
    expect(menu.isOpen()).toBe(true)
    expect(menu.button.getAttribute('aria-expanded')).toBe('true')
    menu.button.click()
    expect(menu.isOpen()).toBe(false)
    expect(menu.button.getAttribute('aria-expanded')).toBe('false')
  })

  test('offers only the controls this game has: the viewer\'s own sensor scan, never another player\'s', () => {
    const menu = createControlPanel(mainWith({ hint: true }))
    menu.setOpen(true)
    expect(switches(menu).map(row => row.textContent)).toEqual(['Sensor scan on my turn (heat map)'])
  })

  test('robots only: "Show all ships"', () => {
    const menu = createControlPanel(mainWith({ allShips: true }))
    menu.setOpen(true)
    expect(switches(menu).map(row => row.textContent)).toEqual(['Show all ships'])
  })

  test('says so when there is nothing to set (hints off or on for everyone)', () => {
    const menu = createControlPanel(mainWith())
    menu.setOpen(true)
    expect(menu.panel.querySelector('.player-bar-none').textContent).toBe('Nothing to set in this game.')
  })

  test('a switch works the game\'s own control: sets it and sends it the change event a click would', () => {
    const main = mainWith({ hint: true })
    const source = main.querySelector('.role-own input')
    const changed = jest.fn(event => event.target.checked)
    source.addEventListener('change', changed)
    const menu = createControlPanel(main)
    menu.setOpen(true)
    const box = switches(menu)[0].querySelector('input')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(source.checked).toBe(true)
    expect(changed).toHaveReturnedWith(true)
  })

  test('sync shows the game\'s own state (it can change elsewhere, e.g. an online push)', () => {
    const main = mainWith({ hint: true })
    const menu = createControlPanel(main)
    menu.setOpen(true)
    main.querySelector('.role-own input').checked = true
    menu.sync()
    expect(switches(menu)[0].querySelector('input').checked).toBe(true)
  })

  describe('the "Game" section', () => {
    const quit = { id: 'quit', label: 'Quit to main menu', confirm: 'Quit this game?', confirmLabel: 'Quit' }
    const answering = (main, actions) => main.addEventListener(GAME_ACTIONS_QUERY, event => event.detail.actions.push(...actions))
    const gameButtons = menu => Array.from(menu.panel.querySelectorAll('.player-bar-actions button')).map(button => button.textContent)

    test('shows the actions the game says apply, asked each time the menu opens', () => {
      const main = mainWith()
      answering(main, [quit])
      const menu = createControlPanel(main)
      menu.setOpen(true)
      expect(gameButtons(menu)).toEqual(['Quit to main menu'])
      expect(menu.panel.querySelector('.player-bar-actions').hidden).toBe(false)
    })

    test('no section when the game offers nothing (or nobody answers)', () => {
      const menu = createControlPanel(mainWith())
      menu.setOpen(true)
      expect(menu.panel.querySelector('.player-bar-actions').hidden).toBe(true)
      expect(Array.from(menu.panel.querySelectorAll('h2')).find(h => h.textContent === 'Game').hidden).toBe(true)
    })

    test('asks first; Cancel goes back with focus on the action, and nothing happens', () => {
      const main = mainWith()
      document.body.append(main)
      answering(main, [quit])
      const sent = jest.fn()
      main.addEventListener(GAME_ACTION_EVENT, sent)
      const menu = createControlPanel(main)
      document.body.append(menu.panel)
      menu.setOpen(true)
      menu.panel.querySelector('[data-action="quit"]').click()
      expect(menu.panel.querySelector('.player-bar-confirm').textContent).toBe('Quit this game?')
      expect(gameButtons(menu)).toEqual(['Quit', 'Cancel'])
      expect(document.activeElement.textContent).toBe('Quit')
      menu.panel.querySelectorAll('.player-bar-actions button')[1].click()
      expect(gameButtons(menu)).toEqual(['Quit to main menu'])
      expect(document.activeElement).toBe(menu.panel.querySelector('[data-action="quit"]'))
      expect(sent).not.toHaveBeenCalled()
      document.body.innerHTML = ''
    })

    test('confirmed: closes the menu and sends the action to the game', () => {
      const main = mainWith()
      answering(main, [quit])
      const sent = jest.fn(event => event.detail.action)
      main.addEventListener(GAME_ACTION_EVENT, sent)
      const menu = createControlPanel(main)
      menu.setOpen(true)
      menu.panel.querySelector('[data-action="quit"]').click()
      menu.panel.querySelector('.is-confirm').click()
      expect(menu.isOpen()).toBe(false)
      expect(sent).toHaveReturnedWith('quit')
    })
  })
})
