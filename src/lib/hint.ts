import type { Word } from '../types'

/**
 * The English definition offered after 想不起来 — the middle term in
 * `situation → concept → word`, which is the path production actually takes.
 *
 * It can be offered at all because `en` is authored to carry the load:
 * docs/word-entry-spec.md requires it to "stand on its own", against the
 * goal of understanding English in English. The Chinese ambiguity that makes
 * the first attempt unfair is absent here — 减轻 is three words in this
 * library (alleviate / assuage / extenuate), but "to make suffering or a
 * problem less severe" is one.
 *
 * Out of range falls back to sense 0 instead of throwing: the write-side
 * gates already reject a dangling index, and if one ever reaches the app the
 * right outcome is a slightly-off hint, not a question that fails to render.
 *
 * Lives in its own module because both question builders need it and
 * `senseGroup.ts` and `recallSentence.ts` already import each other — a
 * value import between them would close the cycle.
 */
export const hintFor = (w: Word, sense?: number): string | undefined => {
  const en = w.meanings[sense ?? 0]?.en ?? w.meanings[0]?.en
  return typeof en === 'string' && en.trim() !== '' ? en : undefined
}
