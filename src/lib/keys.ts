/**
 * Shared logic for keyboard shortcuts.
 *
 * The review page uses 1–4 to grade, the quiz page uses 1–4 to pick an option — each has
 * its own window keydown listener. The judgment of "when the key should **not** be
 * intercepted" must exist in exactly one place. Once it forks, you get bugs that only
 * reproduce on one page, like "pressing 3 in an input field is fine on the review page but
 * the quiz page eats the 3 anyway."
 */

/**
 * Whether focus is currently on a text input control — if so, the keypress must be left to
 * the input itself.
 *
 * The review page and the quiz's multiple-choice questions currently have no input fields,
 * but the spelling question does, and if any future page adds a search box, missing this
 * check means "you literally can't type a digit."
 */
export function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/** Only recognizes 1–9 on the main keyboard/numpad; every other key is left alone. */
const DIGIT = /^[1-9]$/

/**
 * Translates a keypress into an option index (pressing 1 gives 0). Returns -1 when it's not
 * a usable digit key.
 *
 * Two deliberate tradeoffs:
 * - **Any combination with Ctrl / Cmd / Alt is always passed through** — Cmd+1 and Ctrl+1
 *   switch browser tabs, and intercepting them would make people think the browser is
 *   broken.
 * - **Shift is ignored** — on layouts like AZERTY, digits require Shift to type at all, so
 *   excluding Shift as well would make these shortcuts unusable on those keyboards.
 */
export function optionIndexFromKey(e: KeyboardEvent, count: number): number {
  if (e.ctrlKey || e.metaKey || e.altKey) return -1
  if (!DIGIT.test(e.key)) return -1
  if (isEditableTarget(document.activeElement)) return -1
  const i = Number(e.key) - 1
  return i < count ? i : -1
}
