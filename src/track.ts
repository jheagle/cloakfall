/**
 * Anonymous play events, sent to GoatCounter (https://www.goatcounter.com/help/events) when the page has its counter:
 * the website's copy of the game does, this repo's own index.html doesn't, and neither do the tests or the server.
 * Events only name what happened (a mode, a setting, how a game ended), never a player's name or anything typed.
 *
 * Every event is `cloakfall-<name>`, counted each time it happens (no_session), so the dashboard shows how often
 * games start, finish or are left, not how many visitors did so.
 */
import type { GameMode, HintSetting } from './setup/gameOptions'
import type { DomItemRoot } from 'treeloom/dist/domItem/types'

interface GoatCounter {
  count: (vars: { path: string, title?: string, event?: boolean, no_session?: boolean }) => void
}

type TrackWindow = Window & { goatcounter?: Partial<GoatCounter> }

/** Events waiting for count.js, which loads async; dropped if it never comes (blocked, offline). */
const waiting: Array<{ path: string, title: string }> = []
const WAIT_MS = 500
const WAIT_TRIES = 40
let waitTries = 0
let waitTimer: ReturnType<typeof setTimeout> | null = null

const counter = (): GoatCounter | null => {
  const count = (window as TrackWindow).goatcounter?.count
  return typeof count === 'function' ? { count } : null
}

/** Whether this page counts at all: the website's copy loads count.js with a data-goatcounter attribute. */
const pageCounts = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined' &&
  Boolean(document.querySelector?.('script[data-goatcounter]'))

const send = (goatcounter: GoatCounter, path: string, title: string): void => {
  try {
    goatcounter.count({ path, title, event: true, no_session: true })
  } catch {
    // Counting must never break the game
  }
}

const flush = (): void => {
  waitTimer = null
  const goatcounter = counter()
  if (goatcounter) {
    waiting.splice(0).forEach(({ path, title }) => send(goatcounter, path, title))
    return
  }
  if (++waitTries >= WAIT_TRIES) {
    waiting.length = 0
    return
  }
  waitTimer = setTimeout(flush, WAIT_MS)
}

/**
 * An event name made safe and stable: lower case, letters, digits and dashes only.
 * @param name
 */
export const eventPath = (name: string): string =>
  'cloakfall-' + name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/**
 * Count one event. Does nothing on a page without the counter.
 * @param name e.g. 'start-solo'; becomes cloakfall-start-solo
 * @param title a short description shown next to it on the dashboard (never user text)
 */
export const track = (name: string, title: string = ''): void => {
  if (!pageCounts()) {
    return
  }
  const path = eventPath(name)
  const goatcounter = counter()
  if (goatcounter && waiting.length === 0) {
    send(goatcounter, path, title)
    return
  }
  if (waiting.length < 50) {
    waiting.push({ path, title })
  }
  if (!waitTimer) {
    waitTries = 0
    waitTimer = setTimeout(flush, WAIT_MS)
  }
}

/** The mode a game is counted under: the three local ones, or online. */
export type TrackedMode = GameMode | 'online'

/** Roots whose games are never counted: the intro's demo game behind the menu. */
const ignored = new WeakSet<object>()

/**
 * Never count games on this root (the intro's demo, which robots play behind the menu).
 * @param root
 */
export const ignoreGames = (root: DomItemRoot): void => {
  ignored.add(root)
}

/** Games started and not yet finished or left, per page root: what a quit, restart or closed tab abandons. */
const inProgress = new WeakMap<object, TrackedMode>()
let watchingClose = false
let lastRoot: object | null = null

/**
 * A game's turns, rounded down into a few ranges so the dashboard groups them.
 * @param turns
 */
export const turnsBucket = (turns: number): string =>
  turns < 25 ? '0-24' : turns < 50 ? '25-49' : turns < 100 ? '50-99' : turns < 200 ? '100-199' : '200-plus'

/**
 * A game started: its mode, and the settings it started with.
 * @param root the page's game root
 * @param mode
 * @param settings humans, robots and the hint setting (online: the robots and hints the host chose)
 */
export const trackGameStart = (
  root: DomItemRoot,
  mode: TrackedMode,
  settings: { humans?: number, robots?: number, hints?: HintSetting } = {}
): void => {
  if (!pageCounts() || ignored.has(root)) {
    return
  }
  // A game already running on this root was replaced by this one (Restart, or an online host's restart)
  trackAbandon(root, 'restart')
  inProgress.set(root, mode)
  lastRoot = root
  track(`start-${mode}`, `Game started: ${mode}`)
  const { humans, robots, hints } = settings
  if (humans !== undefined && robots !== undefined) {
    track(`players-${mode}-${humans}h-${robots}r`, `${mode}: ${humans} human(s), ${robots} robot(s)`)
  } else if (robots !== undefined) {
    track(`players-${mode}-${robots}r`, `${mode}: ${robots} robot(s)`)
  }
  if (hints) {
    track(`hints-${mode}-${hints}`, `${mode}: hints ${hints}`)
  }
  if (!watchingClose && typeof window.addEventListener === 'function') {
    watchingClose = true
    // A tab closed (or navigated away) mid-game: best effort, the page may be gone before it is sent
    window.addEventListener('pagehide', () => {
      if (lastRoot) {
        trackAbandon(lastRoot as DomItemRoot, 'close')
      }
    })
  }
}

/**
 * A game reached its final score.
 * @param root
 * @param turns every turn taken in the game, all players together (unknown online)
 * @param outcome single player only: whether the human won
 */
export const trackGameEnd = (root: DomItemRoot, turns?: number, outcome?: 'won' | 'lost'): void => {
  const mode = inProgress.get(root)
  if (!mode) {
    return
  }
  inProgress.delete(root)
  track(`finish-${mode}`, `Game finished: ${mode}`)
  if (turns !== undefined) {
    track(`turns-${mode}-${turnsBucket(turns)}`, `${mode}: ${turnsBucket(turns)} turns`)
  }
  if (outcome) {
    track(`finish-${mode}-${outcome}`, `${mode}: the human ${outcome}`)
  }
}

/**
 * A game in progress was left: restarted, quit to the menu, left (online), or the tab closed. Nothing is counted
 * when no game is in progress (the final score, the menu).
 * @param root
 * @param how
 */
export const trackAbandon = (root: DomItemRoot, how: 'restart' | 'quit' | 'leave' | 'close'): void => {
  const mode = inProgress.get(root)
  if (!mode) {
    return
  }
  inProgress.delete(root)
  track(`abandon-${mode}-${how}`, `Game left before the end: ${mode}, ${how}`)
}

let watchingErrors = false
let errorsSent = 0

/**
 * Count the page's uncaught errors (at most 5 per page), titled with where they happened, not their message.
 */
export const trackErrors = (): void => {
  if (watchingErrors || !pageCounts() || typeof window.addEventListener !== 'function') {
    return
  }
  watchingErrors = true
  const where = (file: string | undefined, line: number | undefined): string =>
    `${(file ?? '').split('/').pop()?.split('?')[0] || 'unknown'}:${line ?? 0}`
  window.addEventListener('error', event => {
    if (errorsSent++ < 5) {
      track('error', `Error at ${where(event.filename, event.lineno)}`)
    }
  })
  window.addEventListener('unhandledrejection', () => {
    if (errorsSent++ < 5) {
      track('error-promise', 'Unhandled promise rejection')
    }
  })
}

let watchingLinks = false

/**
 * Count clicks on links marked with data-track (e.g. What's new), through one listener on the document.
 */
export const trackLinks = (): void => {
  if (watchingLinks || !pageCounts()) {
    return
  }
  watchingLinks = true
  document.addEventListener('click', event => {
    const link = (event.target as Element | null)?.closest?.('[data-track]')
    if (link) {
      track(`link-${link.getAttribute('data-track') ?? ''}`, `Opened: ${link.getAttribute('data-track') ?? ''}`)
    }
  }, true)
}
