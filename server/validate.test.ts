/**
 * @jest-environment node
 */
import { cleanGameAction, cleanName, isHintSetting, isRecord } from './validate'

describe('isRecord', () => {
  test('only plain objects', () => {
    expect(isRecord({})).toBe(true)
    expect([null, undefined, 5, 'x', [], true].map(isRecord)).toEqual([false, false, false, false, false, false])
  })
})

describe('cleanName', () => {
  const clean = (value: unknown) => cleanName(value, 10, 'missing', 'too long')

  test('trims, collapses whitespace and drops control characters', () => {
    expect(clean('  Ann \t  Lee ')).toEqual({ name: 'Ann Lee' })
    expect(clean('A\u0000n\u001bn\u007f')).toEqual({ name: 'Ann' })
  })

  test('anything that is not a non-empty string is missing', () => {
    [undefined, null, 5, {}, ['Ann'], '', '   ', '\u0000'].forEach(value => expect(clean(value)).toEqual({ error: 'missing' }))
  })

  test('drops zero-width, bidi and other invisible characters, so a name cannot look blank or reorder itself', () => {
    expect(clean('\u200b\u200c\u200e\u200f\ufeff')).toEqual({ error: 'missing' })
    expect(clean('Ann\u202eeL')).toEqual({ name: 'AnneL' })
    expect(clean('\u2066Bo\u2069\u00ad')).toEqual({ name: 'Bo' })
  })

  test('keeps the zero-width joiner, which emoji sequences need', () => {
    expect(clean('\u{1F468}\u200d\u{1F469}')).toEqual({ name: '\u{1F468}\u200d\u{1F469}' })
  })

  test('too long after cleaning', () => {
    expect(clean('a'.repeat(10))).toEqual({ name: 'a'.repeat(10) })
    expect(clean('a'.repeat(11))).toEqual({ error: 'too long' })
    expect(clean(`  ${'a'.repeat(10)}  `)).toEqual({ name: 'a'.repeat(10) })
  })
})

describe('isHintSetting', () => {
  test('only the three settings', () => {
    expect(['off', 'optional', 'on'].every(isHintSetting)).toBe(true)
    expect(['ON', '', null, 1, 'toString', '__proto__'].some(isHintSetting)).toBe(false)
  })
})

describe('cleanGameAction', () => {
  test('keeps the fields the server uses', () => {
    expect(cleanGameAction({ itemId: 7, eventType: 'click', listenerFunc: 'attackListener', data: [1, 2] }))
      .toEqual({ itemId: 7, eventType: 'click', listenerFunc: 'attackListener', data: [] })
  })

  test('targetState keeps only a string value or a boolean checked (it is copied onto the server element)', () => {
    expect(cleanGameAction({ itemId: 1, eventType: 'change', targetState: { value: '3', innerHTML: '<b>', onclick: 'x' } })?.targetState)
      .toEqual({ value: '3' })
    expect(cleanGameAction({ itemId: 1, eventType: 'change', targetState: { checked: true } })?.targetState).toEqual({ checked: true })
    expect(cleanGameAction({ itemId: 1, eventType: 'change', targetState: JSON.parse('{"__proto__": {"polluted": 1}}') })?.targetState)
      .toBeUndefined()
    expect(cleanGameAction({ itemId: 1, eventType: 'change', targetState: { value: 5, checked: 'yes' } })?.targetState).toBeUndefined()
  })

  test('refuses anything else', () => {
    [null, 5, 'x', [], {}, { itemId: '7', eventType: 'click' }, { itemId: 1.5, eventType: 'click' }, { itemId: 7 },
      { itemId: 7, eventType: '' }, { itemId: 7, eventType: 'x'.repeat(33) }, { itemId: 7, eventType: {} }]
      .forEach(value => expect(cleanGameAction(value)).toBeNull())
  })
})
