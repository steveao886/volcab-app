import { shuffle } from './quiz'
import type { RecallQuestion } from './senseGroup'
import type { Progress, Word } from '../types'

/**
 * 唤词 questions built from Chinese renderings of the library's own example
 * sentences — the second source feeding 回想, beside sense groups.
 *
 * **Why a second source at all.** Measured 2026-08-16 against the live
 * progress: of 454 learned words, only 307 could ever be the answer to a
 * sense-group question and 290 of those had exactly one. A sense group is a
 * *ranking* unit, so its answer needs same-POS confusable partners or
 * hand-written outside distractors, and the words with no confusable twin
 * cannot host one cheaply — 371 groups did not close that and 700 would
 * not. Every word already carries five examples, so rendering those into
 * Chinese gives five retrieval prompts per word with no ranking to author.
 *
 * The renderings are **bundled content, not synced data** (see
 * `src/data/recallSentences.json` and the note on `passage.ts`): the user
 * never edits them. They could not go on the word entry even if that were
 * wanted — `words.json` is 897 KB and 2830 renderings add 221–387 KB of
 * UTF-8, against the 1024 KB ceiling below which the GitHub Contents API
 * returns file content inline. Crossing it stops the library loading at all.
 *
 * See `docs/superpowers/specs/2026-08-16-recall-expansion-design.md`.
 */

export interface RecallSentence {
  /** The word being asked. */
  id: string
  /** Index into that word's `examples` — the sentence this renders. */
  i: number
  /** The Chinese rendering. Contains no Latin letter: it is on screen before the options. */
  zh: string
  /** The chunk of `zh` that is the word itself, shown under an emphasis mark. */
  target: string
}

export interface RecallSentencesFile { version: 1; sentences: RecallSentence[] }

const isLearned = (id: string, progress: Progress): boolean => {
  const e = progress.words[id]
  return e !== undefined && e.state !== 'new'
}

/**
 * The subset that can be asked right now.
 *
 * Only the answer word has to be learned — the distractors are scenery, and
 * "can you produce this word from this situation" is a fair question
 * regardless of what sits next to it. Same rule, same reasoning, as
 * `eligibleGroups`.
 *
 * A sentence whose word or example index no longer exists is skipped rather
 * than throwing: the live library and the repo copy have diverged before
 * (CLAUDE.md), and an entry can be edited down to fewer examples in-app.
 */
export function usableSentences(
  sentences: RecallSentence[],
  words: Map<string, Word>,
  progress: Progress,
): RecallSentence[] {
  return sentences.filter(s => {
    const w = words.get(s.id)
    return w !== undefined && w.examples[s.i] !== undefined && isLearned(s.id, progress)
  })
}

/**
 * The target only when it can actually be rendered — non-blank and locating
 * exactly once. Anything else returns undefined and the page shows the plain
 * sentence, exactly as `senseGroup.ts` decides it: a wrong highlight, or one
 * on two places at once, is worse than none, but the question is still
 * answerable without it.
 */
const usableTarget = (s: RecallSentence): string | undefined => {
  const t = s.target?.trim()
  if (t === undefined || t === '') return undefined
  return s.zh.split(t).length - 1 === 1 ? t : undefined
}

/**
 * One retrieval question, or null when four clean options can't be found.
 *
 * **Distractors are same-POS words that are deliberately _not_ confusable
 * with the answer** — the inverse of `buildRecallQuestion`'s rule, and the
 * single decision here most likely to read as a bug later.
 *
 * A sense group *wants* its confusable members as the wrong options:
 * mistaking `pervade` for `suffuse` is the finding worth having. That works
 * because the group's scenario was authored to make one member clearly
 * best. A translated example was not — it was written to show the word in
 * use — so offering its confusable twin produces "either one fits", and
 * unlike 排序 there is no ranking to absorb a near-miss: a defensible answer
 * is simply marked wrong. Retrieval takes unambiguous distractors;
 * discrimination stays with 排序, which is built for it.
 *
 * Null rather than a mixed-POS or confusable fallback: a fallback fires
 * precisely on the thin cases and quietly turns them into the bad question
 * this rule exists to prevent.
 */
export function buildSentenceQuestion(
  s: RecallSentence,
  words: Map<string, Word>,
  fillerPool: Word[],
  confusable: Map<string, Set<string>>,
  rng: () => number,
): RecallQuestion | null {
  const w = words.get(s.id)
  if (w === undefined) return null
  const en = w.examples[s.i]
  if (en === undefined) return null
  const pos = w.meanings[0]?.pos ?? ''
  const near = confusable.get(s.id)

  const options = new Set<string>([w.headword])
  const eligible = fillerPool.filter(x =>
    x.id !== w.id
    && !(near?.has(x.id) ?? false)
    && (x.meanings[0]?.pos ?? '') === pos
    && x.headword !== w.headword,
  )
  for (const f of shuffle(eligible, rng)) {
    if (options.size >= 4) break
    options.add(f.headword)
  }
  if (options.size < 4) return null

  return {
    kind: 'recall',
    prompt: s.zh,
    target: usableTarget(s),
    // The English original, read straight off the word entry. Storing a copy
    // beside the rendering would give it somewhere to drift to.
    en,
    hint: w.meanings[0]?.en,
    // No `why`: a retrieval question has no ranking to explain, and
    // restating the gloss here would be the padding the content rules keep
    // out of the authored files.
    orderIds: [w.id],
    memberHeadwords: [w.headword],
    options: shuffle([...options], rng),
    answer: [w.headword],
  }
}
