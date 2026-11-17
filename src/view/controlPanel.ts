/**
 * The menu behind the player bar's ☰ button: "My controls" (this slice) and, later, "Game" (quit, restart...).
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
 */
export const createControlPanel = (main: HTMLElement): ControlPanel => {
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
  panel.append(heading, list)

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

  const setOpen = (open: boolean): void => {
    if (open) {
      sync()
    }
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  button.addEventListener('click', () => setOpen(panel.hidden !== false))

  return { button, panel, isOpen: () => panel.hidden === false, setOpen, sync }
}

export default createControlPanel
