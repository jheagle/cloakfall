/**
 * @jest-environment jsdom
 */
import treeloom from 'treeloom'
import { useGameLifecycle, playToTheEnd, startGame, settle } from '../tests/helpers/game'
import { runGameAction } from './setup/gameActions'

useGameLifecycle()

// The website's copy of the game: GoatCounter's script tag, with count.js already loaded
let sent
beforeEach(() => {
  document.head.innerHTML = '<script data-goatcounter="https://example.goatcounter.com/count"></script>'
  sent = []
  window.goatcounter = { count: vars => sent.push(vars) }
})
afterEach(() => {
  delete window.goatcounter
  document.head.innerHTML = ''
})

const paths = () => sent.map(vars => vars.path)

describe('play events from real games', () => {
  test('robots only, played to the end: the menu choice, the start with its settings, and the finish', async () => {
    startGame({ robots: 3, hints: 'off' })
    expect(await playToTheEnd()).toBe(true)
    expect(paths()).toEqual([
      'cloakfall-menu-robots',
      'cloakfall-start-robots',
      'cloakfall-players-robots-0h-3r',
      'cloakfall-hints-robots-off',
      'cloakfall-finish-robots',
      expect.stringMatching(/^cloakfall-turns-robots-(0-24|25-49|50-99|100-199|200-plus)$/)
    ])
    expect(sent.every(vars => vars.event === true && vars.no_session === true)).toBe(true)
  })

  test('single player, quit from the game menu: counted as abandoned, and never with the player\'s name', async () => {
    const { doc, players } = startGame({ humans: 1, robots: 2 })
    players[0].name = 'Secret Name'
    await settle()
    runGameAction(doc, 'quit')
    expect(paths()).toEqual([
      'cloakfall-menu-solo',
      'cloakfall-start-solo',
      'cloakfall-players-solo-1h-2r',
      'cloakfall-hints-solo-optional',
      'cloakfall-abandon-solo-quit'
    ])
    expect(JSON.stringify(sent)).not.toContain('Secret')
    expect(treeloom.getChildrenByClass('main-menu', doc.body)).toHaveLength(1)
  })
})
