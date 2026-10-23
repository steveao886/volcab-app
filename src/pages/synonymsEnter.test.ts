import { describe, expect, it } from 'vitest'
import { enterIntent } from './synonymsEnter'

const key = (over: Partial<KeyboardEvent> = {}) => ({
  key: 'Enter', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
})

describe('enterIntent', () => {
  it("swallows a held Enter's auto-repeat instead of passing it to the focused button", () => {
    // Passed through, each repeat's keypress clicks 下一组 (it keeps focus
    // after a mouse click) and stamps a group nobody read.
    expect(enterIntent(key({ repeat: true }), 'other', true)).toBe('swallow')
  })

  it('acts on a fresh Enter', () => {
    expect(enterIntent(key(), 'other', true)).toBe('act')
  })

  it('passes Enter to a focused link and to an editable field', () => {
    expect(enterIntent(key(), 'link', true)).toBe('pass')
    expect(enterIntent(key(), 'editable', true)).toBe('pass')
    expect(enterIntent(key({ repeat: true }), 'link', true)).toBe('pass')
  })

  it('passes other keys and a modified Enter', () => {
    expect(enterIntent(key({ key: ' ' }), 'other', true)).toBe('pass')
    expect(enterIntent(key({ shiftKey: true }), 'other', true)).toBe('pass')
  })

  it('passes when there is nothing to act on', () => {
    expect(enterIntent(key(), 'other', false)).toBe('pass')
  })
})
