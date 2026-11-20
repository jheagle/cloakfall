/**
 * @jest-environment jsdom
 */
import { aboutSection, creditLine, CREDIT_LINKS } from './credits'
import finalScore from './finalScore'
import remoteFinalScore from './remoteFinalScore'
import mainMenu from './mainMenu'

const all = item => [item, ...(item.children ?? []).flatMap(all)]
const byClass = (item, className) => all(item).filter(each => String(each.attributes?.className ?? '').split(' ').includes(className))
/** The <a> tags written into an item's innerHTML (the credits are written that way, like the version line). */
const linksIn = item => all(item).flatMap(each => {
  const holder = document.createElement('div')
  holder.innerHTML = each.attributes?.innerHTML ?? ''
  return [...holder.querySelectorAll('a')]
})

test('the credit links are absolute, so they work from the repo\'s own page too', () => {
  Object.values(CREDIT_LINKS).forEach(href => expect(href).toMatch(/^https:\/\//))
})

test('About is a closed <details>: who made it, the project, the source, more work, and a privacy note', () => {
  const about = aboutSection()
  expect(about.nodeName).toBe('details')
  expect(about.attributes.open).toBeUndefined()
  expect(about.children[0]).toMatchObject({ nodeName: 'summary', attributes: { innerHTML: 'About Cloakfall', 'data-track': 'about' } })
  const links = linksIn(about)
  expect(links.map(a => [a.getAttribute('href'), a.dataset.track])).toEqual([
    [CREDIT_LINKS.portfolio, 'about-portfolio'],
    [CREDIT_LINKS.project, 'about-project'],
    [CREDIT_LINKS.source, 'about-source'],
    [CREDIT_LINKS.portfolio, 'about-more'],
    [CREDIT_LINKS.privacy, 'about-privacy']
  ])
  // New tabs, so the game is kept
  links.forEach(a => expect([a.target, a.rel]).toEqual(['_blank', 'noopener']))
})

test('the main menu has the About section, next to the version line', () => {
  const menu = mainMenu()
  const content = byClass(menu, 'content')[0]
  const classes = content.children.map(child => child.attributes.className)
  expect(classes.indexOf('about')).toBe(classes.indexOf('version-line') + 1)
})

test('both final scores end with the credit line, each with its own data-track', () => {
  const scored = name => ({ name, status: 50, attacks: { sunk: 1, hit: 2, miss: 3 }, turnCnt: 4 })
  for (const [build, track] of [[finalScore, 'credit-final'], [remoteFinalScore, 'credit-final-online']]) {
    const scores = build([scored('Ann'), scored('Bo')])
    const credit = scores.children[scores.children.length - 1]
    expect(credit.attributes.className).toBe('credit-line')
    expect(linksIn(credit).map(a => [a.getAttribute('href'), a.dataset.track])).toEqual([[CREDIT_LINKS.portfolio, track]])
  }
  expect(creditLine().attributes.innerHTML).toContain('data-track="credit-final"')
})
