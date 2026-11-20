import treeloom from 'treeloom'
import type { DomItem } from 'treeloom/dist/domItem/types'

/** Where the game's credits point. Absolute, so they work from the repo's own page too, not only the website's copy. */
export const CREDIT_LINKS = {
  portfolio: 'https://joshuaheagle.com/',
  project: 'https://joshuaheagle.com/projects/cloakfall/',
  source: 'https://github.com/jheagle/cloakfall',
  privacy: 'https://joshuaheagle.com/privacy/'
}

/**
 * A link that opens in a new tab (so the game is kept), counted as a play event when clicked (data-track, see
 * track.ts's trackLinks).
 * @param href
 * @param text
 * @param track
 */
const link = (href: string, text: string, track: string): string =>
  `<a href="${href}" target="_blank" rel="noopener" data-track="${track}">${text}</a>`

/**
 * The main menu's About: who made the game, where to find more of their work and the game's code, and what the game
 * counts. A <details>, so it stays one line until opened and needs no listener.
 */
export const aboutSection = (): DomItem => treeloom.createDomItem({
  nodeName: 'details',
  attributes: { className: 'about' },
  children: [
    { nodeName: 'summary', attributes: { innerHTML: 'About Cloakfall', 'data-track': 'about' } },
    {
      nodeName: 'p',
      attributes: {
        innerHTML: `Cloakfall is made by ${link(CREDIT_LINKS.portfolio, 'Joshua Heagle', 'about-portfolio')}, a full-stack ` +
          'engineer, and built on his own open-source libraries, treeloom and treeloom-matrix.'
      }
    },
    {
      nodeName: 'p',
      attributes: {
        innerHTML: `${link(CREDIT_LINKS.project, 'About the game and its libraries', 'about-project')} · ` +
          `${link(CREDIT_LINKS.source, 'Source on GitHub', 'about-source')} · ` +
          `${link(CREDIT_LINKS.portfolio, 'More of his work', 'about-more')}`
      }
    },
    {
      nodeName: 'p',
      attributes: {
        className: 'about-privacy',
        innerHTML: 'The game counts how it gets played, anonymously (never names or anything you type), to see what to ' +
          `improve. ${link(CREDIT_LINKS.privacy, 'Privacy', 'about-privacy')}`
      }
    }
  ]
})

/**
 * One line under the final scores: who made the game, and where to find more.
 * @param track the data-track name, so the menu's and each final score's clicks can be told apart
 */
export const creditLine = (track: string = 'credit-final'): DomItem => treeloom.createDomItem({
  nodeName: 'p',
  attributes: {
    className: 'credit-line',
    innerHTML: `Cloakfall is made by Joshua Heagle. ${link(CREDIT_LINKS.portfolio, 'More games and projects', track)}`
  }
})
