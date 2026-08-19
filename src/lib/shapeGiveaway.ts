/**
 * "Can this option's correctness be read off the prompt's spelling?"
 *
 * `contrast.ts` and `antonym.ts` both guard one failure — a four-choice
 * question with **two** correct answers. This file guards its mirror image:
 * a four-choice question with **zero required knowledge**. Prompt
 * `fallible`, options `infallible / austere / turbid / laconic`, and a
 * learner who has met neither word answers it by noticing that one option
 * is the prompt with two letters bolted on the front.
 *
 * Same defect as the antonym question's part-of-speech rule ("three verbs
 * standing beside one adjective hand the answer over without the learner
 * reading a single word"), reached through spelling rather than grammar.
 *
 * Measured over the 599-word library: 53 containment hits, 3 -ful/-less
 * swaps, 4 one-token phrase pairs. Inside `antonymPick` that is 5 of 94
 * library pairs; inside `synonymHint`, 28 of 1964 reachable hints.
 *
 * See docs/superpowers/specs/2026-08-19-antonym-giveaway-and-external-design.md.
 */

const norm = (s: string) => s.trim().toLowerCase()

/**
 * The floor on clause 1. `ire` sits inside `admire`, `end` inside
 * `commend`, `ail` inside `curtail` — coincidences that tell a learner
 * nothing, and without the floor each one would delete a good question.
 */
const MIN_CONTAINED = 4

/**
 * Tokens that carry no meaning of their own in clause 3.
 *
 * Deliberately tiny and closed: it only has to separate "the shared part
 * of these two phrases is a preposition" from "the shared part is a word".
 * A general stopword list would start swallowing content — `no` and `out`
 * are here because `no` and `out` genuinely never distinguish two phrases
 * in this library, not as the start of a slippery slope.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'at',
  'by', 'it', 'is', 'be', 'no', 'and', 'or', 'off', 'up', 'out', "one's",
])

/**
 * Clause 1 — containment.
 *
 * **This is what a prefix list would be, without the list.** `un- / in- /
 * im- / il- / ir- / dis- / non- / anti-` are enumerated nowhere:
 * `fallible` is inside `infallible`, `purity` inside `impurity`,
 * `hearten` inside `dishearten`. An enumerated list would be a second
 * thing to keep correct, and would rot the first time a word arrived
 * under a prefix nobody thought to list.
 *
 * It also covers a leak that has nothing to do with negation, which a
 * prefix list would have missed entirely: `topple` / `topple over`,
 * `mire` / `quagmire`, `begrudge` / `grudge`.
 */
function contained(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= MIN_CONTAINED && long.includes(short)
}

/** Clause 2 — the one swap containment cannot reach, since neither side contains the other. */
function fulLessSwap(a: string, b: string): boolean {
  for (const [s, l] of [[a, b], [b, a]] as const) {
    if (s.endsWith('ful') && l === `${s.slice(0, -3)}less`) return true
  }
  return false
}

/**
 * Clause 3 — two phrases of equal length differing in exactly one token,
 * where at least one *shared* token carries meaning.
 *
 * The content-word requirement is the whole reason this clause is safe.
 * Without it the rule fires on `stem from` / `arise from`, `account for` /
 * `answer for` and `in the wake of` / `in the aftermath of`, where the
 * only thing in common is a preposition — the learner still has to know
 * the verb, so nothing has been handed over. With it, the clause fires on
 * exactly the four that do leak: `level playing field` / `tilted playing
 * field`, `race to the bottom` / `race to the top`, `with a pinch of
 * salt` / `with a grain of salt`, `fall through` / `fall apart`.
 */
function oneTokenApart(a: string, b: string): boolean {
  const left = a.split(/\s+/)
  const right = b.split(/\s+/)
  if (left.length < 2 || left.length !== right.length) return false

  let differing = 0
  let sharesContent = false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) differing++
    else if (!FUNCTION_WORDS.has(left[i])) sharesContent = true
  }
  return differing === 1 && sharesContent
}

/**
 * Symmetric: callers ask about a prompt and an option without caring which
 * side the affix landed on.
 *
 * A blank is never a giveaway. The same trap `antonym.ts` and
 * `contrast.ts` guard one clause over — the empty string is contained in
 * every other string, so clause 1 alone would flag the entire library.
 */
export function isShapeGiveaway(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (x === '' || y === '' || x === y) return false
  return contained(x, y) || fulLessSwap(x, y) || oneTokenApart(x, y)
}
