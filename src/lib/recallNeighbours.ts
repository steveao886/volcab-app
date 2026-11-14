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
 * has. Measured over the 7,435 renderings on 2026-11-13: 1,154 get no row,
 * the median is 2, p90 5, and the gloss path adds a word on 494.
 *
 * See docs/superpowers/specs/2026-11-13-recall-reveal-neighbours-design.md.
 */
export interface Neighbour {
  id: string
  headword: string
  pos: string
  zh: string
  en: string
}

/** p90 is 5 over the library; a longer list pushes 下一题 down a 375px screen. */
export const NEIGHBOUR_CAP = 6

const norm = (s: string) => s.trim().toLowerCase()
const isCjk = (t: string) => /^[一-鿿…]+$/.test(t)

export function recallNeighbours(
  answer: Word,
  sense: number,
  target: string | undefined,
  onScreen: readonly string[],
  words: readonly Word[],
): Neighbour[] {
  const rendered = answer.meanings[sense] ?? answer.meanings[0]
  if (rendered === undefined) return []
  const pos = rendered.pos
  const byHead = new Map(words.map(w => [norm(w.headword), w]))
  const shut = new Set([norm(answer.headword), ...onScreen.map(norm)])
  const picked: Word[] = []
  const take = (w: Word | undefined) => {
    if (w === undefined || w.id === answer.id || shut.has(norm(w.headword))) return
    shut.add(norm(w.headword))
    picked.push(w)
  }

  for (const h of cardSynonyms(answer, words)) take(byHead.get(norm(h)))

  // A one-character term (退, 沉) would match almost any target.
  const onTarget = target === undefined
    ? []
    : glossTerms(rendered.zh).filter(t => t.length >= 2 && isCjk(t) && target.includes(t))
  if (onTarget.length > 0) {
    const glossed = words
      .filter(w => w.meanings.some(m => m.pos === pos && glossTerms(m.zh).some(t => onTarget.includes(t))))
      .sort((a, b) => a.headword.localeCompare(b.headword))
    for (const w of glossed) take(w)
  }

  return picked.slice(0, NEIGHBOUR_CAP).map(w => {
    const m = w.meanings.find(x => x.pos === pos) ?? w.meanings[0]
    return { id: w.id, headword: w.headword, pos: m?.pos ?? '', zh: m?.zh ?? '', en: m?.en ?? '' }
  })
}
