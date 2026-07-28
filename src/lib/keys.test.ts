import { afterEach, describe, expect, it } from 'vitest'
import { isEditableTarget, optionIndexFromKey } from './keys'

/**
 * The shortcut-key decision logic is tested here, not with a component test on the page —
 * the convention that "the UI itself gets no component tests" still holds (see the top of
 * store.test.tsx). The page layer is reduced to a single line — "map the index to an option
 * and call choose" — and every branch worth testing (modifier keys, out of range, inside an
 * input) lives in this pure function.
 */

/** Build a key event. No modifier keys by default. */
function key(k: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, ...mods })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isEditableTarget', () => {
  it('null does not count', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  it('input / textarea / select all count', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('contentEditable counts too', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    document.body.append(el)
    expect(isEditableTarget(el)).toBe(true)
  })

  it('a plain button does not count — otherwise tabbing onto an option would make number keys unusable', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
  })
})

describe('optionIndexFromKey', () => {
  it('1-4 maps to 0-3', () => {
    expect(optionIndexFromKey(key('1'), 4)).toBe(0)
    expect(optionIndexFromKey(key('4'), 4)).toBe(3)
  })

  it('returns -1 when it exceeds the option count', () => {
    expect(optionIndexFromKey(key('5'), 4)).toBe(-1)
  })

  it('0 and non-digit keys return -1', () => {
    for (const k of ['0', 'Enter', ' ', 'a', 'F1', 'ArrowDown']) {
      expect(optionIndexFromKey(key(k), 4)).toBe(-1)
    }
  })

  it('Ctrl / Cmd / Alt combos are let through — those are browser tab-switching shortcuts', () => {
    expect(optionIndexFromKey(key('1', { ctrlKey: true }), 4)).toBe(-1)
    expect(optionIndexFromKey(key('1', { metaKey: true }), 4)).toBe(-1)
    expect(optionIndexFromKey(key('1', { altKey: true }), 4)).toBe(-1)
  })

  it('Shift is not excluded — on AZERTY, digits require Shift anyway', () => {
    expect(optionIndexFromKey(key('1', { shiftKey: true }), 4)).toBe(0)
  })

  it('always returns -1 when focus is inside an input', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(optionIndexFromKey(key('1'), 4)).toBe(-1)
  })
})
