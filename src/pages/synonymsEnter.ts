/** What 近义词's window keydown listener does with a key: leave it to the browser, cancel it, or advance. */
export type EnterIntent = 'pass' | 'swallow' | 'act'

/** Where focus sits when the key arrives. */
export type EnterFocus = 'editable' | 'link' | 'other'

/**
 * **A held Enter's auto-repeat is swallowed, not passed.** 下一组 keeps focus
 * after a mouse click, and Chrome activates a focused button on the keypress
 * after each keydown that is not cancelled — the 组句 mechanism (CLAUDE.md).
 * Returning before preventDefault let every repeat click the button and stamp
 * a group nobody read: holding Enter for half a second after one click
 * reached the end screen (final review, 2026-10-23). Untangle.tsx orders it
 * the same way. A focused link (回今日) and an editable field keep their own
 * Enter, repeat or not.
 */
export function enterIntent(
  e: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  focus: EnterFocus,
  canAct: boolean,
): EnterIntent {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return 'pass'
  if (focus !== 'other' || !canAct) return 'pass'
  return e.repeat ? 'swallow' : 'act'
}
