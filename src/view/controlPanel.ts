/**
 * The menu behind the player bar's ☰ button: "My controls", then "Game" (restart, quit, leave...), then "How to play"
 * (the first-game hints again, firstGameHints.ts).
 *
 * Like the bar, it lives outside the game's tree. Its switches don't hold any state of their own: each mirrors a
 * control the game already renders (the sensor-scan checkbox in the viewer's own player panel, robots-only's "Show
 * all ships") and works it, by setting that control and sending it the same change event a click would. So local
 * games run their listener as before, and online games forward it to the server through the existing path, where a
 * player's own controls work on any turn (CLOA-14). Those originals are hidden while the bar is up
 * (layouts-custom.sass).
 */

/** A control the game renders that the panel mirrors: where to find it, and what to call it. */
interface MirroredControl {
  /** Inside <main>. */
  selector: string
  label: string
}

/**
 * The controls the panel offers, in order: only those the current game actually has are shown. The sensor scan is in
 * the viewer's own panel when the game's hint setting is "optional" (playerStats.ts); "Show all ships" is robots-only
 * (showShipsControl.ts).
 */
export const MIRRORED_CONTROLS: MirroredControl[] = [
  { selector: ':scope > .boards > .role-own .player-controls input[type=checkbox]', label: 'Sensor scan on my turn (heat map)' },
  { selector: ':scope > .ships-control input.all-ships', label: 'Show all ships' }
]

/**
 * The event the menu sends on <main> when it opens, to ask which game actions apply right now: the game fills in
 * detail.actions (setup/gameActions.ts). Nobody answering means no "Game" section.
 */
export const GAME_ACTIONS_QUERY = 'cloakfall:game-actions'

/** The event the menu sends on <main> once the viewer has confirmed an action, or flipped a setting: detail:
 * { action } (its id), plus { checked } for a setting. */
export const GAME_ACTION_EVENT = 'cloakfall:game-action'

/** One action the game offers in the menu's "Game" section. */
export interface GameAction {
  /** Sent back in GAME_ACTION_EVENT. */
  id: string
  label: string
  /** The question asked before it happens ("Quit this game?"), and the word on the button that says yes. A setting
   * (below) is never asked about: it is a switch, flipped back as easily. */
  confirm?: string
  confirmLabel?: string
  /** A setting rather than an action: shown as a switch, on or off as given. */
  setting?: { checked: boolean }
}

/** What the bar needs from the panel. */
export interface ControlPanel {
  button: HTMLButtonElement
  panel: HTMLElement
  isOpen: () => boolean
  setOpen: (open: boolean) => void
  /** Bring the switches up to date with the game's own controls (which there are, and whether each is on). */
  sync: () => void
}

/**
 * Build the ☰ button and its panel (not yet in the page: the bar places them).
 * @param main the game's <main>
 * @param onHelp what the menu's last button, "How to play", does (firstGameHints.ts); no button without it
 */
export const createControlPanel = (main: HTMLElement, onHelp?: () => void): ControlPanel => {
  const doc = main.ownerDocument
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'player-bar-menu'
  button.textContent = '☰'
  button.setAttribute('aria-label', 'Menu')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', 'player-bar-panel')

  const panel = doc.createElement('div')
  panel.id = 'player-bar-panel'
  panel.className = 'player-bar-panel'
  panel.hidden = true
  const heading = doc.createElement('h2')
  heading.textContent = 'My controls'
  const list = doc.createElement('div')
  list.className = 'player-bar-controls'
  const gameHeading = doc.createElement('h2')
  gameHeading.textContent = 'Game'
  const gameList = doc.createElement('div')
  gameList.className = 'player-bar-actions'
  panel.append(heading, list, gameHeading, gameList)

  /** A button in the panel. */
  const panelButton = (text: string, onClick: () => void, className: string = 'player-bar-action'): HTMLButtonElement => {
    const action = doc.createElement('button')
    action.type = 'button'
    action.className = className
    action.textContent = text
    action.addEventListener('click', onClick)
    return action
  }

  /**
   * Ask before acting, in the panel itself: the question, then the action's own word and Cancel. Cancel goes back to
   * the list, with focus on the action again.
   */
  const askFirst = (action: GameAction): void => {
    const question = doc.createElement('p')
    question.className = 'player-bar-confirm'
    question.textContent = action.confirm ?? ''
    const yes = panelButton(action.confirmLabel ?? action.label, () => {
      setOpen(false)
      main.dispatchEvent(new CustomEvent(GAME_ACTION_EVENT, { detail: { action: action.id } }))
    }, 'player-bar-action is-confirm')
    const no = panelButton('Cancel', () => {
      showGameActions()
      gameList.querySelector<HTMLElement>(`[data-action="${action.id}"]`)?.focus()
    })
    gameList.replaceChildren(question, yes, no)
    yes.focus()
  }

  /** The "Game" section: whatever the game says applies now (none: the section isn't shown). */
  const showGameActions = (): void => {
    const query = new CustomEvent<{ actions: GameAction[] }>(GAME_ACTIONS_QUERY, { detail: { actions: [] } })
    main.dispatchEvent(query)
    const actions = query.detail.actions
    gameHeading.hidden = !actions.length
    gameList.hidden = !actions.length
    gameList.replaceChildren(...actions.map(action => {
      if (action.setting) {
        const row = doc.createElement('label')
        row.className = 'player-bar-control'
        row.dataset.action = action.id
        const box = doc.createElement('input')
        box.type = 'checkbox'
        box.checked = action.setting.checked
        box.addEventListener('change', () => {
          main.dispatchEvent(new CustomEvent(GAME_ACTION_EVENT, { detail: { action: action.id, checked: box.checked } }))
        })
        const text = doc.createElement('span')
        text.textContent = action.label
        row.append(box, text)
        return row
      }
      const item = panelButton(action.label, () => askFirst(action))
      item.dataset.action = action.id
      return item
    }))
  }

  if (onHelp) {
    const help = panelButton('How to play', () => {
      setOpen(false)
      onHelp()
    }, 'player-bar-action player-bar-help')
    panel.append(help)
  }

  // Which of MIRRORED_CONTROLS the switches were last built for, so they are only rebuilt when that changes
  let built: string | null = null

  const sync = (): void => {
    const found = MIRRORED_CONTROLS
      .map(control => ({ control, source: main.querySelector<HTMLInputElement>(control.selector) }))
      .filter((entry): entry is { control: MirroredControl, source: HTMLInputElement } => entry.source !== null)
    const key = found.map(entry => entry.control.label).join('|')
    if (key !== built) {
      built = key
      list.replaceChildren(...(found.length
        ? found.map(({ control }) => {
          const row = doc.createElement('label')
          row.className = 'player-bar-control'
          const box = doc.createElement('input')
          box.type = 'checkbox'
          box.addEventListener('change', () => {
            // Found again at the moment of the change: an online push may have replaced the element since
            const source = main.querySelector<HTMLInputElement>(control.selector)
            if (!source) {
              return
            }
            source.checked = box.checked
            source.dispatchEvent(new Event('change', { bubbles: true }))
          })
          const text = doc.createElement('span')
          text.textContent = control.label
          row.append(box, text)
          return row
        })
        : [Object.assign(doc.createElement('p'), { className: 'player-bar-none', textContent: 'Nothing to set in this game.' })]))
    }
    found.forEach(({ source }, i) => {
      const box = list.children[i]?.querySelector('input')
      if (box && box.checked !== source.checked) {
        box.checked = source.checked
      }
    })
  }

  function setOpen (open: boolean): void {
    if (open) {
      sync()
      showGameActions()
    }
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  button.addEventListener('click', () => setOpen(panel.hidden !== false))

  return { button, panel, isOpen: () => panel.hidden === false, setOpen, sync }
}

export default createControlPanel
