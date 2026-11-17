/**
 * The player bar: a bar fixed to the bottom of the screen during play, with every player's name, status and turn,
 * that also chooses which opponent's board is shown on a phone (one at a time, full width; wide screens show every
 * board and the bar scrolls to the one tapped).
 *
 * It runs entirely in the viewer's own browser, outside the game's tree, the same way remoteGame.ts's countdown
 * does: in online play every listener inside the tree is forwarded to the server, and every push rebuilds what is
 * inside <main>, so a tap there would go to the server and a choice kept there would be overwritten. Instead it
 * reads the rendered page (the players' role classes and playerStats.ts's data-status / data-turn) whenever <main>
 * changes, and shows the chosen board with a stylesheet of its own. Local and online games work the same way.
 */

/** Wider than this, every board is shown (side by side); narrower, one opponent at a time. */
import createControlPanel from './controlPanel'
import createTurnBanner from './turnBanner'

export const ONE_BOARD_MAX_WIDTH_PX = 759

/**
 * The event the bar sends on <main> when the viewer's own board opens or closes (detail: { open }): on a phone, its
 * drawer; on a wide screen, where it is docked and always in view, open whenever there is one. Local multiplayer
 * listens (setup/ownBoardReveal.ts).
 */
export const OWN_BOARD_EVENT = 'cloakfall:own-board'

/** One player, as read from the rendered page. */
export interface BarPlayer {
  /** Position among .boards' children (0-based), which is how the stylesheet picks the board to show. It can change
   * from turn to turn (local multiplayer puts the current player's board first), so choices are kept by id. */
  index: number
  /** Who this is, whatever their position: their colour (unique within a game), else their name. */
  id: string
  name: string
  colour: string
  status: number
  /** 'attacker' while it is their turn, 'winner' at the end, '' otherwise (playerStats.ts's data-turn). */
  turn: string
  /** This viewer's own board (role-own): never hidden, and not one to choose. */
  own: boolean
  /** A board this viewer can fire at right now (role-target): only during their own turn. */
  target: boolean
  /** Shots on this player's board so far (cells with data-shot), to follow the action. */
  shots: number
  /** Whether the board has a role yet (role-own/target/summary): not while ships are still being placed. */
  placed: boolean
}

/** What the viewer has chosen and what the bar last saw, carried from one refresh to the next. */
export interface BarState {
  /** The opponent the viewer picked (an id), or null for "the first one alive". */
  chosen: string | null
  /** The player the last shot landed on while it wasn't this viewer's turn (an id), or null. */
  followed: string | null
  /** Shots per player (by id) at the last refresh. */
  shots: Record<string, number>
}

export const initialBarState = (): BarState => ({ chosen: null, followed: null, shots: {} })

/** Whether a player is still in the game. */
const alive = (player: BarPlayer): boolean => player.status > 0

/**
 * Which board to show (an index), or null when there is nothing to choose between. During the viewer's own turn: the
 * one they chose while it can still be fired at, else the first target. Otherwise (someone else's turn, or a game
 * with no human, robots only): the board the latest shot landed on, else the one they chose, else the first
 * opponent still alive. The viewer's own board is never one of these (it is always shown).
 * @param players
 * @param state
 */
export const boardToShow = (players: BarPlayer[], state: BarState): number | null => {
  const others = players.filter(player => !player.own)
  if (!others.length) {
    return null
  }
  const myTurn = others.some(player => player.target)
  const pick = (id: string | null, allowed: (player: BarPlayer) => boolean): number | null =>
    others.find(player => id !== null && player.id === id && allowed(player))?.index ?? null
  if (myTurn) {
    return pick(state.chosen, player => player.target) ?? others.find(player => player.target)!.index
  }
  return pick(state.followed, () => true) ??
    pick(state.chosen, alive) ??
    (others.find(alive) ?? others[0]).index
}

/**
 * The state after a refresh: the shot counts now, and which board to follow - the one a new shot landed on, unless
 * it is the viewer's own turn (then they are choosing, and their own shots don't move the view) or the shot was on
 * their own board (always shown anyway).
 * @param players
 * @param state
 */
export const nextBarState = (players: BarPlayer[], state: BarState): BarState => {
  const myTurn = players.some(player => player.target)
  const hit = players.find(player => !player.own && player.shots > (state.shots[player.id] ?? player.shots))
  const shots: Record<string, number> = {}
  players.forEach(player => { shots[player.id] = player.shots })
  return {
    chosen: state.chosen,
    followed: myTurn ? null : (hit?.id ?? state.followed),
    shots
  }
}

/**
 * Whether the game is being played, as opposed to the menu, placing ships, choosing the order, or the end. It starts
 * when someone first has the turn, and lasts until the boards go, someone wins, or ships are being placed again (a
 * restart): between two turns there is a moment when nobody has the turn, which must not hide the bar or forget
 * what the viewer chose.
 * @param players
 * @param wasInPlay what this returned last time
 */
export const inPlay = (players: BarPlayer[], wasInPlay: boolean = false): boolean => {
  if (!players.length || players.some(player => player.turn === 'winner') || !players.some(player => player.placed)) {
    return false
  }
  return players.some(player => player.turn === 'attacker') || wasInPlay
}

/**
 * Read the players from the rendered page: .boards' .player children, with their stats' data attributes.
 * @param main
 */
export const readPlayers = (main: Element): BarPlayer[] => {
  const boards = Array.from(main.children).find(child => child.classList.contains('boards'))
  if (!boards) {
    return []
  }
  return Array.from(boards.children).flatMap((element, index) => {
    if (!element.classList.contains('player')) {
      return []
    }
    const stats = element.querySelector<HTMLElement>(':scope > .player-stats')
    const strong = stats?.querySelector<HTMLElement>('.player-name strong')
    const name = strong?.textContent ?? ''
    const colour = strong?.style.color ?? ''
    return [{
      index,
      id: colour || name,
      name,
      colour,
      status: Number(stats?.dataset.status ?? 0),
      turn: stats?.dataset.turn ?? '',
      own: element.classList.contains('role-own'),
      target: element.classList.contains('role-target'),
      shots: element.querySelectorAll('[data-shot]').length,
      placed: /\brole-/.test(element.className)
    }]
  })
}

/**
 * The stylesheet that shows one opponent's board on a narrow screen: every other player's board but the viewer's own
 * is hidden, the boards' own stats lists give way to the bar, and another player's own controls (their sensor-scan
 * box, in local multiplayer) aren't shown on their board.
 * @param shown
 */
export const oneBoardCss = (shown: number | null): string => shown === null
  ? ''
  : `@media (max-width: ${ONE_BOARD_MAX_WIDTH_PX}px) {
  main.game > .boards > .player:not(.role-own):not(:nth-child(${shown + 1})) { display: none !important; }
  main.game > .boards > .player:not(.role-own) > .player-stats > ul,
  main.game > .boards > .player:not(.role-own) > .player-stats > .player-controls { display: none; }
}`

/** The words for a player's status in the bar. */
const statusText = (player: BarPlayer): string => {
  if (player.turn === 'winner') {
    return 'winner'
  }
  return player.status > 0 ? `${player.status}%` : 'out'
}

/** Set a text only when it differs, so an unchanged entry isn't touched at all. */
const setText = (element: Element, text: string): void => {
  if (element.textContent !== text) {
    element.textContent = text
  }
}

/** What a tap on an entry does: show that opponent's board, or open/close (or go to) the viewer's own board. */
interface BarActions {
  choose: (index: number) => void
  toggleOwn: () => void
}

/**
 * One entry's elements: a button with the player's name, status and a "firing" marker (shown only on the attacker's
 * entry). An opponent's shows their board; the viewer's own opens their board's drawer on a phone. Built once per
 * player and then updated in place (updateEntry).
 * @param player
 * @param actions
 */
const createEntry = (player: BarPlayer, actions: BarActions): HTMLLIElement => {
  const item = document.createElement('li')
  item.dataset.index = String(player.index)
  item.dataset.own = String(player.own)
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.className = player.own ? 'player-bar-entry is-own' : 'player-bar-entry'
  for (const part of ['name', 'status', 'turn']) {
    const span = document.createElement('span')
    span.className = `player-bar-${part}`
    entry.append(span)
  }
  setText(entry.lastElementChild!, 'firing')
  entry.addEventListener('click', () => player.own ? actions.toggleOwn() : actions.choose(player.index))
  item.append(entry)
  return item
}

/** Set an attribute only when it differs (or remove it, for null). */
const setAttribute = (element: Element, name: string, value: string | null): void => {
  if (element.getAttribute(name) === value) {
    return
  }
  if (value === null) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, value)
  }
}

/**
 * Bring an entry up to date, changing only what differs.
 * @param item
 * @param player
 * @param shown
 * @param ownOpen whether the viewer's own board's drawer is open, or null where there is no drawer (wide screens)
 */
const updateEntry = (item: HTMLLIElement, player: BarPlayer, shown: number | null, ownOpen: boolean | null): void => {
  const entry = item.firstElementChild as HTMLElement
  const [name, status, turn] = Array.from(entry.children) as HTMLElement[]
  if (entry.style.getPropertyValue('--player-colour') !== player.colour) {
    entry.style.setProperty('--player-colour', player.colour)
  }
  entry.classList.toggle('is-attacker', player.turn === 'attacker')
  entry.classList.toggle('is-out', !alive(player))
  setText(name, player.own ? `${player.name} (you)` : player.name)
  setText(status, statusText(player))
  if (turn.hidden !== (player.turn !== 'attacker')) {
    turn.hidden = player.turn !== 'attacker'
  }
  if (player.own) {
    setAttribute(entry, 'aria-expanded', ownOpen === null ? null : String(ownOpen))
  } else {
    setAttribute(entry, 'aria-pressed', String(player.index === shown))
  }
}

/**
 * Show one entry per player: the entries are rebuilt only when the players themselves change (a new game, or whose
 * own entry it is, as in local multiplayer); otherwise each is updated in place, so a turn change touches a few
 * texts and attributes rather than the whole bar.
 * @param list
 * @param players
 * @param shown
 * @param ownOpen
 * @param actions
 */
const renderBar = (list: HTMLElement, players: BarPlayer[], shown: number | null, ownOpen: boolean | null, actions: BarActions): void => {
  const items = Array.from(list.children) as HTMLLIElement[]
  const same = items.length === players.length &&
    players.every((player, i) => items[i].dataset.index === String(player.index) && items[i].dataset.own === String(player.own))
  if (!same) {
    list.replaceChildren(...players.map(player => createEntry(player, actions)))
  }
  players.forEach((player, i) => updateEntry(list.children[i] as HTMLLIElement, player, shown, ownOpen))
}

/**
 * Add the player bar to the page and keep it in step with <main>. Returns a function that removes it again.
 *
 * On a phone it also opens and closes the drawer the viewer's own board lives in (the CSS in layouts-custom.sass
 * moves the role-own board into it, and dims the page around it): body.own-board-open. It closes on Escape, on a tap
 * outside it, when the game ends, and when the board it shows stops being the viewer's (local multiplayer: every
 * turn, so nobody sees another player's ships by accident). A tap outside only closes it: it never reaches the board
 * underneath, so closing the drawer can't fire a shot.
 * @param main the game's <main> (setup/gameRoot.ts)
 */
export const installPlayerBar = (main: HTMLElement): (() => void) => {
  const doc = main.ownerDocument
  const nav = doc.createElement('nav')
  nav.className = 'player-bar'
  nav.setAttribute('aria-label', 'Players')
  nav.hidden = true
  const list = doc.createElement('ul')
  nav.append(list)
  const style = doc.createElement('style')
  main.after(nav, style)
  const view = doc.defaultView
  // No matchMedia (some test DOMs): treated as a wide screen, so no drawer
  const narrow = view?.matchMedia?.(`(max-width: ${ONE_BOARD_MAX_WIDTH_PX}px)`) ?? null

  let state = initialBarState()
  let frame: number | null = null
  // What the bar last showed, so a refresh that changes nothing in it (most do: a shot only changes a board) leaves
  // the bar's elements alone
  let rendered = ''
  let playing = false
  let players: BarPlayer[] = []
  let drawerOpen = false
  let ownId: string | null = null
  // What the game was last told about the viewer's own board (ownBoardReveal.ts), so it is told only of changes
  let toldOpen: boolean | null = null
  const menu = createControlPanel(main)
  nav.prepend(menu.panel)
  nav.append(menu.button)
  // Whose turn it is, across the top (turnBanner.ts)
  const banner = createTurnBanner(doc)
  nav.after(banner.element)

  /**
   * Tell the game whether the viewer's own board is open: the drawer on a phone; docked on a wide screen, so open
   * whenever there is one. Local multiplayer shows that player's ships only while it is (ownBoardReveal.ts).
   */
  const tellOwnBoard = (): void => {
    const open = playing && ownId !== null && (narrow?.matches ? drawerOpen : true)
    if (open === toldOpen) {
      return
    }
    toldOpen = open
    main.dispatchEvent(new CustomEvent(OWN_BOARD_EVENT, { detail: { open } }))
  }

  /** Open or close the own board's drawer (a no-op when it is already that way). */
  const setDrawer = (open: boolean): void => {
    if (drawerOpen === open) {
      return
    }
    drawerOpen = open
    doc.body.classList.toggle('own-board-open', open)
    rendered = ''
    schedule()
  }

  const refresh = (): void => {
    frame = null
    players = readPlayers(main)
    playing = inPlay(players, playing)
    const ownNow = players.find(player => player.own)?.id ?? null
    if (!playing || ownNow !== ownId) {
      setDrawer(false)
      // A new own board (local multiplayer: the next player) is told about afresh
      toldOpen = null
    }
    ownId = ownNow
    tellOwnBoard()
    // Wide screens dock the viewer's own board in a column of its own, apart from the opponents' boards
    // (layouts-custom.sass); robots-only has no own board, so the opponents keep the whole width
    doc.body.classList.toggle('has-own-board', playing && ownNow !== null)
    banner.update(players, playing)
    if (!playing) {
      state = initialBarState()
      rendered = ''
      menu.setOpen(false)
      nav.hidden = true
      doc.body.classList.remove('has-player-bar')
      style.textContent = ''
      return
    }
    state = nextBarState(players, state)
    const shown = boardToShow(players, state)
    const css = oneBoardCss(shown)
    if (style.textContent !== css) {
      style.textContent = css
    }
    const ownOpen = narrow?.matches ? drawerOpen : null
    const key = JSON.stringify([shown, ownOpen, players.map(({ shots, id, ...shownFacts }) => shownFacts)])
    if (key !== rendered) {
      rendered = key
      renderBar(list, players, shown, ownOpen, { choose, toggleOwn })
    }
    if (menu.isOpen()) {
      menu.sync()
    }
    nav.hidden = false
    doc.body.classList.add('has-player-bar')
  }

  /** The viewer picked a board: show it from now on (until the action moves on), and bring it into view. */
  const choose = (index: number): void => {
    state = { ...state, chosen: players.find(player => player.index === index)?.id ?? null, followed: null }
    refresh()
    const board = main.querySelector(`:scope > .boards > :nth-child(${index + 1})`)
    board?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  /** The viewer's own entry: open/close the drawer on a phone; on a wide screen the board is always there, so go to it. */
  const toggleOwn = (): void => {
    if (narrow?.matches) {
      setDrawer(!drawerOpen)
      return
    }
    main.querySelector(':scope > .boards > .role-own')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  // Escape closes the menu first (it sits on top), then the drawer, and puts focus back on what opened it
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }
    if (menu.isOpen()) {
      menu.setOpen(false)
      menu.button.focus()
    } else if (drawerOpen) {
      setDrawer(false)
      nav.querySelector<HTMLElement>('.is-own')?.focus()
    }
  }
  // In the capture phase, before any listener in the game (a shot) sees the tap: a tap outside the open menu or
  // drawer only closes it. The bar is left alone (the menu is part of it; its own entry toggles the drawer, and the
  // others switch boards behind it), and so is the inside of an open drawer while the menu is closed.
  const onOutsideTap = (event: Event): void => {
    const target = event.target as Node | null
    if (!target || nav.contains(target) || (!drawerOpen && !menu.isOpen())) {
      return
    }
    const ownBoard = main.querySelector(':scope > .boards > .role-own')
    const inDrawer = drawerOpen && Boolean(ownBoard?.contains(target))
    if (inDrawer && !menu.isOpen()) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    menu.setOpen(false)
    if (!inDrawer) {
      setDrawer(false)
    }
  }
  // Growing past phone width: the board is back on the page, so the drawer state no longer applies
  const onWidth = (): void => {
    setDrawer(false)
    rendered = ''
    schedule()
  }
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('click', onOutsideTap, true)
  narrow?.addEventListener?.('change', onWidth)

  function schedule (): void {
    if (frame === null) {
      frame = requestAnimationFrame(refresh)
    }
  }
  const observer = new MutationObserver(schedule)
  observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-status', 'data-turn', 'data-shot'] })
  schedule()

  return () => {
    observer.disconnect()
    banner.destroy()
    doc.removeEventListener('keydown', onKey)
    doc.removeEventListener('click', onOutsideTap, true)
    narrow?.removeEventListener?.('change', onWidth)
    doc.body.classList.remove('own-board-open', 'has-own-board')
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }
    nav.remove()
    style.remove()
    doc.body.classList.remove('has-player-bar')
  }
}

export default installPlayerBar
