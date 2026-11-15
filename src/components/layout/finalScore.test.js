/**
 * @jest-environment jsdom
 */
import treeloom from 'treeloom'
import finalScore from './finalScore'
import remoteFinalScore from './remoteFinalScore'

describe('finalScore', () => {
  test('renders with parent of body', () => {
    treeloom.registerListener((e) => {}, 'restart')
    treeloom.registerListener((e) => {}, 'playAgain')
    treeloom.registerListener((e) => {}, 'returnToLobby')
    const renderedItem = treeloom.renderHtml(finalScore())
    expect(renderedItem.parentItem.nodeName).toBe('body')
  })

  const scored = name => ({ name, status: 50, attacks: { sunk: 1, hit: 2, miss: 3 }, turnCnt: 4 })

  test('names on the score cards are shown as text, never as markup, local and online', () => {
    for (const build of [finalScore, remoteFinalScore]) {
      const find = item => item.attributes?.className === 'score-cards' ? item : (item.children || []).map(find).find(Boolean)
      const cards = find(build([scored('<img src=x onerror=a()>'), scored('Bo')])).children
      expect(cards[0].attributes.innerHTML).toMatch(/^<strong>&lt;img src=x onerror=a\(\)&gt;<\/strong><hr><br><strong>Status:<\/strong> 50%/)
      expect(cards[1].attributes.innerHTML).toMatch(/^<strong>Bo<\/strong>/)
    }
  })
})
