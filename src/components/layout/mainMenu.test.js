/**
 * @jest-environment jsdom
 */
import treeloom from 'treeloom'
import mainMenu from './mainMenu'
import { version } from '../../version'

describe('mainMenu', () => {
  test('renders with parent of body', () => {
    treeloom.registerListener((e) => {}, 'beginRound')
    treeloom.registerListener((e) => {}, 'presetListener')
    treeloom.registerListener((e) => {}, 'remoteListener')
    const renderedItem = treeloom.renderHtml(mainMenu())
    expect(renderedItem.parentItem.nodeName).toBe('body')
  })

  test('shows the running version under the tagline, linking to its release notes and the server status', () => {
    const menu = treeloom.renderHtml(mainMenu())
    const line = menu.element.querySelector('.tagline + .version-line')
    expect(line.textContent).toBe(`v${version} · What's new · Server status`)
    const [notes, status] = line.querySelectorAll('a')
    expect(notes.getAttribute('href')).toBe(`https://github.com/jheagle/cloakfall/releases/tag/v${version}`)
    expect(status.getAttribute('href')).toBe('status.html')
    expect([notes, status].every(link => link.target === '_blank' && link.rel === 'noopener')).toBe(true)
  })
})
