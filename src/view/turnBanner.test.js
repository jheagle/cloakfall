/**
 * @jest-environment jsdom
 */
import createTurnBanner, { TURN_DEADLINE_EVENT, secondsLeft, turnText } from './turnBanner'

const player = (name, overrides = {}) => ({ index: 0, id: name, name, colour: '', status: 100, turn: '', own: false, target: false, shots: 0, placed: true, ...overrides })

describe('turnText', () => {
  test('your own turn (local multiplayer: whoever holds the device)', () => {
    expect(turnText([player('Ann', { own: true, turn: 'attacker' }), player('Bob')])).toBe('Your turn, Ann')
  })

  test('someone else\'s turn while you wait', () => {
    expect(turnText([player('Ann', { own: true }), player('Bob', { turn: 'attacker' })])).toBe('Waiting for Bob to fire')
  })

  test('robots only (no viewer): who is firing', () => {
    expect(turnText([player('Robot 1'), player('Robot 2', { turn: 'attacker' })])).toBe('Robot 2 is firing')
  })

  test('between turns (nobody firing): nothing new to say', () => {
    expect(turnText([player('Ann', { own: true }), player('Bob')])).toBeNull()
  })
})

describe('secondsLeft', () => {
  test('rounds up, never below 0', () => {
    expect(secondsLeft(10500, 0)).toBe(11)
    expect(secondsLeft(0, 5000)).toBe(0)
  })
})

describe('createTurnBanner', () => {
  afterEach(() => {
    document.body.className = ''
    document.body.innerHTML = ''
  })

  const setUp = () => {
    const banner = createTurnBanner(document)
    document.body.append(banner.element)
    return { banner, text: banner.element.querySelector('.turn-banner-text'), countdown: banner.element.querySelector('.turn-banner-countdown') }
  }

  test('says whose turn it is, as a live region, and slides in afresh at each turn change', () => {
    const { banner, text } = setUp()
    banner.update([player('Ann', { own: true, turn: 'attacker' }), player('Bob')], true)
    expect(banner.element.hidden).toBe(false)
    expect(text.getAttribute('role')).toBe('status')
    expect(text.textContent).toBe('Your turn, Ann')
    expect(banner.element.classList.contains('is-new')).toBe(true)
    expect(document.body.classList.contains('has-turn-banner')).toBe(true)
    banner.element.classList.remove('is-new')
    // Between turns: kept as it was, no new slide
    banner.update([player('Ann', { own: true }), player('Bob')], true)
    expect(text.textContent).toBe('Your turn, Ann')
    expect(banner.element.classList.contains('is-new')).toBe(false)
    banner.update([player('Ann', { own: true }), player('Bob', { turn: 'attacker' })], true)
    expect(text.textContent).toBe('Waiting for Bob to fire')
    expect(banner.element.classList.contains('is-new')).toBe(true)
    banner.destroy()
  })

  test('hidden when not in play', () => {
    const { banner } = setUp()
    banner.update([player('Ann', { own: true, turn: 'attacker' })], true)
    banner.update([], false)
    expect(banner.element.hidden).toBe(true)
    expect(document.body.classList.contains('has-turn-banner')).toBe(false)
    banner.destroy()
  })

  test('a turn with a time limit shows the seconds left (not announced); none without one', () => {
    jest.useFakeTimers()
    const { banner, countdown } = setUp()
    expect(countdown.hidden).toBe(true)
    expect(countdown.getAttribute('aria-hidden')).toBe('true')
    document.dispatchEvent(new CustomEvent(TURN_DEADLINE_EVENT, { detail: { deadline: Date.now() + 20000 } }))
    expect(countdown.hidden).toBe(false)
    expect(countdown.textContent).toBe('20s')
    jest.advanceTimersByTime(5000)
    expect(countdown.textContent).toBe('15s')
    document.dispatchEvent(new CustomEvent(TURN_DEADLINE_EVENT, { detail: { deadline: null } }))
    expect(countdown.hidden).toBe(true)
    banner.destroy()
    jest.useRealTimers()
  })
})
