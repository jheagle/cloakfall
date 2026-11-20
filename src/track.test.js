/**
 * @jest-environment jsdom
 */
import { eventPath, turnsBucket } from './track'

/** Listeners each fresh copy of track.ts adds to the shared window/document, removed after each test. */
const added = []
const record = target => {
  const original = target.addEventListener.bind(target)
  jest.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    added.push([target, type, listener, options])
    original(type, listener, options)
  })
}

/** A fresh copy of track.ts (its waiting queue and listeners are per module), on a page with or without the counter. */
const loadTrack = ({ counter = true, loaded = true } = {}) => {
  document.head.innerHTML = counter ? '<script data-goatcounter="https://example.goatcounter.com/count"></script>' : ''
  record(window)
  record(document)
  const sent = []
  window.goatcounter = loaded ? { count: vars => sent.push(vars) } : undefined
  let track
  jest.isolateModules(() => { track = require('./track') })
  return { track, sent, paths: () => sent.map(vars => vars.path) }
}

afterEach(() => {
  added.splice(0).forEach(([target, type, listener, options]) => target.removeEventListener(type, listener, options))
  jest.restoreAllMocks()
  jest.useRealTimers()
  delete window.goatcounter
  document.head.innerHTML = ''
})

describe('eventPath', () => {
  test('prefixes cloakfall- and keeps only lower-case letters, digits and dashes', () => {
    expect(eventPath('start-solo')).toBe('cloakfall-start-solo')
    expect(eventPath('Players Multi/2h 0r!')).toBe('cloakfall-players-multi-2h-0r')
    expect(eventPath('--a--b--')).toBe('cloakfall-a-b')
  })
})

describe('turnsBucket', () => {
  test('groups turns into ranges', () => {
    expect([0, 24, 25, 49, 50, 99, 100, 199, 200, 999].map(turnsBucket))
      .toEqual(['0-24', '0-24', '25-49', '25-49', '50-99', '50-99', '100-199', '100-199', '200-plus', '200-plus'])
  })
})

describe('track', () => {
  test('sends an event, counted every time (no_session), with its title', () => {
    const { track, sent } = loadTrack()
    track.track('menu-solo', 'Menu: solo')
    expect(sent).toEqual([{ path: 'cloakfall-menu-solo', title: 'Menu: solo', event: true, no_session: true }])
  })

  test('does nothing on a page without the counter script (this repo, the tests, the server)', () => {
    jest.useFakeTimers()
    const { track, sent } = loadTrack({ counter: false })
    track.track('menu-solo')
    jest.advanceTimersByTime(60000)
    expect(sent).toEqual([])
  })

  test('waits for count.js to load, then sends in order', () => {
    jest.useFakeTimers()
    const { track, sent, paths } = loadTrack({ loaded: false })
    track.track('menu-solo')
    track.track('start-solo')
    expect(sent).toEqual([])
    window.goatcounter = { count: vars => sent.push(vars) }
    jest.advanceTimersByTime(500)
    expect(paths()).toEqual(['cloakfall-menu-solo', 'cloakfall-start-solo'])
  })

  test('drops what is waiting when count.js never loads (blocked), and stops polling', () => {
    jest.useFakeTimers()
    const { track, sent } = loadTrack({ loaded: false })
    track.track('menu-solo')
    jest.advanceTimersByTime(60000)
    window.goatcounter = { count: vars => sent.push(vars) }
    jest.advanceTimersByTime(60000)
    expect(sent).toEqual([])
  })

  test('a counter that throws never breaks the game', () => {
    const { track } = loadTrack()
    window.goatcounter = { count: () => { throw new Error('blocked') } }
    expect(() => track.track('menu-solo')).not.toThrow()
  })
})

describe('game events', () => {
  test('a local game: start with its settings, then finish with its turns and outcome', () => {
    const { track, paths } = loadTrack()
    const root = {}
    track.trackGameStart(root, 'solo', { humans: 1, robots: 2, hints: 'optional' })
    track.trackGameEnd(root, 30, 'won')
    expect(paths()).toEqual([
      'cloakfall-start-solo',
      'cloakfall-players-solo-1h-2r',
      'cloakfall-hints-solo-optional',
      'cloakfall-finish-solo',
      'cloakfall-turns-solo-25-49',
      'cloakfall-finish-solo-won'
    ])
  })

  test('games on an ignored root (the intro demo) are never counted', () => {
    const { track, paths } = loadTrack()
    const demo = {}
    track.ignoreGames(demo)
    track.trackGameStart(demo, 'robots', { humans: 0, robots: 3, hints: 'off' })
    track.trackGameEnd(demo, 40)
    track.trackAbandon(demo, 'quit')
    expect(paths()).toEqual([])
  })

  test('quitting counts as abandoned only while a game is in progress', () => {
    const { track, paths } = loadTrack()
    const root = {}
    track.trackAbandon(root, 'quit')
    track.trackGameStart(root, 'robots')
    track.trackAbandon(root, 'quit')
    track.trackAbandon(root, 'quit')
    expect(paths()).toEqual(['cloakfall-start-robots', 'cloakfall-abandon-robots-quit'])
  })

  test('starting again mid-game counts the first as abandoned by a restart; after the final score it does not', () => {
    const { track, paths } = loadTrack()
    const root = {}
    track.trackGameStart(root, 'multi')
    track.trackGameStart(root, 'multi')
    track.trackGameEnd(root, 10)
    track.trackGameStart(root, 'multi')
    expect(paths()).toEqual([
      'cloakfall-start-multi',
      'cloakfall-abandon-multi-restart',
      'cloakfall-start-multi',
      'cloakfall-finish-multi',
      'cloakfall-turns-multi-0-24',
      'cloakfall-start-multi'
    ])
  })

  test('online: no turns or outcome when unknown; closing the tab mid-game counts as abandoned', () => {
    const { track, paths } = loadTrack()
    const root = {}
    track.trackGameStart(root, 'online')
    track.trackGameEnd(root)
    track.trackGameStart(root, 'online')
    window.dispatchEvent(new Event('pagehide'))
    expect(paths()).toEqual([
      'cloakfall-start-online',
      'cloakfall-finish-online',
      'cloakfall-start-online',
      'cloakfall-abandon-online-close'
    ])
  })
})

describe('links and errors', () => {
  test('a click on a data-track link is counted', () => {
    const { track, paths } = loadTrack()
    track.trackLinks()
    document.body.innerHTML = '<a href="#" data-track="whats-new"><span>What\'s new</span></a><a href="#">other</a>'
    document.querySelector('span').click()
    document.querySelectorAll('a')[1].click()
    expect(paths()).toEqual(['cloakfall-link-whats-new'])
  })

  test('uncaught errors are counted with where they happened, at most 5 per page', () => {
    const { track, sent } = loadTrack()
    track.trackErrors()
    for (let i = 0; i < 7; ++i) {
      window.dispatchEvent(new ErrorEvent('error', { message: 'secret player name', filename: 'https://x/browser/cloakfall.js?v=1', lineno: 42 }))
    }
    expect(sent.length).toBe(5)
    expect(sent[0]).toMatchObject({ path: 'cloakfall-error', title: 'Error at cloakfall.js:42' })
    expect(JSON.stringify(sent)).not.toContain('secret')
  })
})
