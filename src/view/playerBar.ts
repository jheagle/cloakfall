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
export const ONE_BOARD_MAX_WIDTH_PX = 759

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

/**
 * One entry's elements: a button for an opponent, plain text for the viewer's own entry; name, status and a "firing"
 * marker (shown only on the attacker's entry). Built once per player and then updated in place (updateEntry).
 * @param player
 * @param choose
 */
const createEntry = (player: BarPlayer, choose: (index: number) => void): HTMLLIElement => {
  const item = document.createElement('li')
  item.dataset.index = String(player.index)
  item.dataset.own = String(player.own)
  const entry = document.createElement(player.own ? 'span' : 'button')
  entry.className = 'player-bar-entry'
  for (const part of ['name', 'status', 'turn']) {
    const span = document.createElement('span')
    span.className = `player-bar-${part}`
    entry.append(span)
  }
  setText(entry.lastElementChild!, 'firing')
  if (entry instanceof HTMLButtonElement) {
    entry.type = 'button'
    entry.addEventListener('click', () => choose(player.index))
  }
  item.append(entry)
  return item
}

/**
 * Bring an entry up to date, changing only what differs.
 * @param item
 * @param player
 * @param shown
 */
const updateEntry = (item: HTMLLIElement, player: BarPlayer, shown: number | null): void => {
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
  if (entry instanceof HTMLButtonElement && entry.getAttribute('aria-pressed') !== String(player.index === shown)) {
    entry.setAttribute('aria-pressed', String(player.index === shown))
  }
}

/**
 * Show one entry per player: the entries are rebuilt only when the players themselves change (a new game, or whose
 * own entry it is, as in local multiplayer); otherwise each is updated in place, so a turn change touches a few
 * texts and attributes rather than the whole bar.
 * @param list
 * @param players
 * @param shown
 * @param choose
 */
const renderBar = (list: HTMLElement, players: BarPlayer[], shown: number | null, choose: (index: number) => void): void => {
  const items = Array.from(list.children) as HTMLLIElement[]
  const same = items.length === players.length &&
    players.every((player, i) => items[i].dataset.index === String(player.index) && items[i].dataset.own === String(player.own))
  if (!same) {
    list.replaceChildren(...players.map(player => createEntry(player, choose)))
  }
  players.forEach((player, i) => updateEntry(list.children[i] as HTMLLIElement, player, shown))
}

/**
 * Add the player bar to the page and keep it in step with <main>. Returns a function that removes it again.
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

  let state = initialBarState()
  let frame: number | null = null
  // What the bar last showed, so a refresh that changes nothing in it (most do: a shot only changes a board) leaves
  // the bar's elements alone
  let rendered = ''
  let playing = false
  let players: BarPlayer[] = []

  const refresh = (): void => {
    frame = null
    players = readPlayers(main)
    playing = inPlay(players, playing)
    if (!playing) {
      state = initialBarState()
      rendered = ''
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
    const key = JSON.stringify([shown, players.map(({ shots, id, ...shownFacts }) => shownFacts)])
    if (key !== rendered) {
      rendered = key
      renderBar(list, players, shown, choose)
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

  const schedule = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(refresh)
    }
  }
  const observer = new MutationObserver(schedule)
  observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-status', 'data-turn', 'data-shot'] })
  schedule()

  return () => {
    observer.disconnect()
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }
    nav.remove()
    style.remove()
    doc.body.classList.remove('has-player-bar')
  }
}

export default installPlayerBar
