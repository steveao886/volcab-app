import type { Word } from '../types'
import { cardSynonyms } from './contrast'
import { glossTerms } from './forget'

/**
 * The words near a 回想 answer, listed on the reveal after a miss on a
 * sentence-sourced question (相近的词).
 *
 * That reveal used to name nothing but the answer. A user report on
 * 2026-11-13: 她的怒气在回家的路上渐渐平息, answer `subside`. They had
 * thought of placate, took 我想的不是这几个, and never saw it again. placate
 * and appease carry 平息(怒气) in their own gloss, and neither fits — they
 * make *someone else* less angry, where the anger here dies down by itself.
 * Each entry's English definition is what shows that ("to make someone less
 * angry" against "to become less intense"), so it is carried alongside the
 * Chinese.
 *
 * **Two sources, in this order.** First the answer's card synonyms that are
 * in the library, so the row agrees with the word's card. Then same-POS
 * words sharing a gloss term of the rendered sense **that appears in the
 * marked target**: the Chinese the learner read is what led them to the word
 * they produced, so the key is the term on screen, not every term the sense
 * has. Measured over the 7,435 renderings on 2026-11-14, after a review
 * kept first-sense synonyms off second-sense renderings: 1,666 get no row
 * (1,154 before), the median is 2, p90 4.
 *
 * See docs/superpowers/specs/2026-11-13-recall-reveal-neighbours-design.md.
 */
export interface GlossLine {
  pos: string
  zh: string
  /** The English definition, on the focus sense only. */
  en?: string
}

/**
 * A word as the reveal lists it: every sense, one of them in focus. Closed,
 * a row shows the focus sense's Chinese; open, it shows every line. The
 * goodwill report (2026-11-14) is why every sense is carried: the user had
 * never met the sense the rendering used.
 */
export interface WordGloss {
  id: string
  headword: string
  focus: number
  lines: GlossLine[]
}

/** p90 is 4 over the library; a longer list pushes 下一题 down a 375px screen. */
export const NEIGHBOUR_CAP = 6

const norm = (s: string) => s.trim().toLowerCase()
const isCjk = (t: string) => /^[一-鿿…]+$/.test(t)

/** The word's first sense of this part of speech, else its first. */
export function focusSense(word: Word, pos: string): number {
  const at = word.meanings.findIndex(m => m.pos === pos)
  return at === -1 ? 0 : at
}

export function wordGloss(word: Word, focus: number): WordGloss {
  const f = word.meanings[focus] === undefined ? 0 : focus
  return {
    id: word.id,
    headword: word.headword,
    focus: f,
    lines: word.meanings.map((m, k) => (k === f ? { pos: m.pos, zh: m.zh, en: m.en } : { pos: m.pos, zh: m.zh })),
  }
}

/**
 * The reveal's four options, each keyed by the string printed on it. The
 * answer focuses on the sense the rendering is about; any other option on
 * its sense of the answer's part of speech, which is the sense a learner
 * weighed it under. An option not in the library is omitted and its row
 * does not expand — read side lenient.
 */
export function optionGlosses(
  answer: Word,
  sense: number,
  options: readonly string[],
  words: readonly Word[],
): Map<string, WordGloss> {
  const byHead = new Map(words.map(w => [norm(w.headword), w]))
  const pos = (answer.meanings[sense] ?? answer.meanings[0])?.pos ?? ''
  const out = new Map<string, WordGloss>()
  for (const opt of options) {
    const w = byHead.get(norm(opt))
    if (w === undefined) continue
    out.set(opt, wordGloss(w, w.id === answer.id ? sense : focusSense(w, pos)))
  }
  return out
}

export function recallNeighbours(
  answer: Word,
  sense: number,
  target: string | undefined,
  onScreen: readonly string[],
  words: readonly Word[],
): WordGloss[] {
  const secondary = sense > 0 && answer.meanings[sense] !== undefined
  const rendered = answer.meanings[sense] ?? answer.meanings[0]
  if (rendered === undefined) return []
  const pos = rendered.pos
  const renderedTerms = glossTerms(rendered.zh).filter(isCjk)
  /** The word's first sense of this POS sharing one of `terms`, else -1. */
  const sharing = (w: Word, terms: readonly string[]) =>
    w.meanings.findIndex(m => m.pos === pos && glossTerms(m.zh).some(t => terms.includes(t)))
  const byHead = new Map(words.map(w => [norm(w.headword), w]))
  const shut = new Set([norm(answer.headword), ...onScreen.map(norm)])
  const picked: WordGloss[] = []
  const take = (w: Word | undefined, focus: number) => {
    if (w === undefined || w.id === answer.id || shut.has(norm(w.headword))) return
    shut.add(norm(w.headword))
    picked.push(wordGloss(w, focus))
  }

  // A synonym list hangs off the word, and in practice off its first sense.
  // On a rendering of a later sense it must share a gloss term with that
  // sense, or it is a neighbour of a meaning the sentence is not about:
  // callous asked as 老茧 listed insensitive (review, 2026-11-14). Either
  // way the row opens on the sense that matched, when one did.
  for (const h of cardSynonyms(answer, words)) {
    const w = byHead.get(norm(h))
    if (w === undefined) continue
    const k = sharing(w, renderedTerms)
    if (secondary && k === -1) continue
    take(w, k === -1 ? focusSense(w, pos) : k)
  }

  // A one-character term (退, 沉) would match almost any target. The row
  // focuses the sense that matched: degrade came in through 贬低 and was
  // shown under 退化 until the review caught it.
  const onTarget = target === undefined
    ? []
    : renderedTerms.filter(t => t.length >= 2 && target.includes(t))
  if (onTarget.length > 0) {
    const glossed = words
      .map(w => ({ w, k: sharing(w, onTarget) }))
      .filter(x => x.k !== -1)
      .sort((a, b) => a.w.headword.localeCompare(b.w.headword))
    for (const { w, k } of glossed) take(w, k)
  }

  return picked.slice(0, NEIGHBOUR_CAP)
}
