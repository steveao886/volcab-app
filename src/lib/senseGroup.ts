import { difficultyWeight, shuffle, weightedShuffle } from './quiz'
import type { Progress, Word } from '../types'

/**
 * 回想 — the Chinese-to-English direction, tap-only.
 *
 * A sense group is one authored unit feeding two question types: 唤词
 * (which word did you retrieve?) and 排序 (all members fit; which fits
 * best?). The prompt is a scenario sentence, not a gloss — measured over
 * the library, the tightest confusable groups have near-identical glosses
 * (suffuse/pervade/permeate all read 弥漫/渗透), so a gloss-keyed ordering
 * would be arguable, and an arguable key poisons the mode. See
 * docs/superpowers/specs/2026-08-07-recall-mode-design.md.
 *
 * Everything here is pure. The page paints what these functions decide.
 */

export interface SenseGroup {
  /** The scenario sentence, Chinese only — it is on screen before any option, so a single Latin letter is a leak. */
  zh: string
  /**
   * The chunk of `zh` the learner is asked to express — rendered with an
   * emphasis mark. Required on the write side (validate-sense-groups:
   * present, no Latin, appears in zh exactly once); optional here because
   * the read side stays lenient — a group whose target is missing or can't
   * be located renders the plain sentence rather than being dropped.
   * Without the mark the question was unanswerable in practice: a sentence
   * carries half a dozen content words and nothing said which one was
   * wanted (user-reported on day one).
   */
  target?: string
  /**
   * The scenario said in English, using the answer word — what you were
   * being asked to produce, finally spelled out.
   *
   * Shown **only after answering**, which is why it can exist at all: the
   * same string above the options would be the answer in plain sight, the
   * exact leak `zh`'s no-Latin rule exists to prevent. Before this the
   * reveal named the word and explained the distinction, and never once
   * showed the word doing the job — you learned that `implicate` beats
   * `incriminate` here without seeing the sentence either would go into.
   *
   * Optional here and required by validate-sense-groups, the same split as
   * `target`: the read side skips a missing one rather than dropping the
   * question.
   */
  en?: string
  /** Word ids, best fit first. The whole answer key for 排序; order[0] is the answer for 唤词. */
  order: string[]
  /**
   * Confusable distractors that are **not in the library** — plain
   * headwords, not ids.
   *
   * The mode was capped at 59 groups by requiring every member to be a
   * library word. Measured over the 504-word library: 121 words were in a
   * group, and **380 more had no library-internal partner at all** — their
   * natural rivals are ordinary words the learner already knows. `astute`
   * has no rival among C1/C2 Latinate entries; against `shrewd`, `canny`,
   * `sagacious` it becomes a real question.
   *
   * These are only ever wrong options. They are never ranked — ordering a
   * word the library does not carry would mean authoring a judgment about
   * something outside the vocabulary, and a group holding any is asked as
   * 唤词 only. Tapping one behaves exactly like tapping a filler: it maps
   * to no id and marks nothing (see wrongIdsFor).
   */
  extra?: string[]
  /**
   * Which of the **answer word's** senses this scenario is about — an index
   * into `order[0]`'s `meanings`. Drives the English hint and nothing else.
   *
   * Defaults to 0, the highest-share sense, which is what a scenario is
   * almost always written about. Audited over all 329 groups: 79 have a
   * polysemous answer and **exactly one** of them is about a secondary
   * sense — `agreeable`'s 只要各方都点头 scenario is "willing to go along
   * with", sense 1, while sense 0 is "pleasant, and easy to spend time with
   * or in". Left to the default, that group's hint would have pointed the
   * learner away from the word it was asking for.
   *
   * One case in 329 is still worth a field rather than a rewritten
   * scenario: the alternative is a rule that every group must be about its
   * answer's dominant sense, which would quietly ban the 30%-share senses
   * from ever being asked.
   *
   * Optional here and range-checked by validate-sense-groups, the same
   * write-strict / read-lenient split as `target` and `en`.
   */
  sense?: number
  /** One or two sentences naming the dimension that decides the ranking. */
  why: string
}

export interface SenseGroupsFile { version: 1; groups: SenseGroup[] }

export type RecallKind = 'recall' | 'order'

export interface RecallQuestion {
  kind: RecallKind
  /** The scenario sentence. Doubles as the prompt key for recency rotation. */
  prompt: string
  /** The chunk of prompt to emphasize — the part being asked. Absent when the group carries none or it can't be located; the page then shows the plain sentence. */
  target?: string
  /** The scenario in English, using the answer. Revealed with the answer, never before it. */
  en?: string
  /**
   * The answer word's English definition for the sense in play — shown
   * **only after 想不起来**, as a second retrieval attempt.
   *
   * Absent on 排序, where all three members are on screen from the start and
   * a definition would hand over the ranking the question exists to ask.
   */
  hint?: string
  why: string
  /** Every group member's word id, in answer-key order (best first). */
  orderIds: string[]
  /** Members' headwords, parallel to orderIds — what wrongIdsFor maps a tapped option back through. */
  memberHeadwords: string[]
  /** 唤词: four headwords, shuffled. 排序: the members' headwords, shuffled. */
  options: string[]
  /** 唤词: the correct headword. 排序: headwords in key order. */
  answer: string[]
}

const isLearned = (id: string, progress: Progress): boolean => {
  const e = progress.words[id]
  return e !== undefined && e.state !== 'new'
}

/**
 * Groups that can be asked at all — i.e. as 唤词.
 *
 * **Only the answer has to be learned.** The other members are distractors;
 * "can you produce this word from this meaning" is a fair question whether
 * or not you happen to know the words sitting next to it. Requiring all
 * three was the original rule and it strangled the mode: measured over the
 * library with learned words taken in review-queue order (usageScore
 * descending, per queue.ts), the all-learned rule leaves **11 playable
 * groups at 250 learned words and 13 at 300** — under a 10-question round,
 * so every round drew the same set and the recency rotation could only
 * reorder it. Answer-only leaves **34 and 38**. Reported as "做了好几轮
 * 10 道题都没过呀,一直都是这 10 道题".
 *
 * Every member must still **exist in the library** — a group with a missing
 * id (the live library and the repo copy have diverged before, see
 * CLAUDE.md) is skipped whole rather than played with a hole in it.
 */
export function eligibleGroups(
  groups: SenseGroup[],
  words: Map<string, Word>,
  progress: Progress,
): SenseGroup[] {
  return groups.filter(g =>
    // One library member is enough *when the group brings its own outside
    // distractors*. What must never happen is a lone member with none: the
    // other three options would all be random same-POS fillers, and a
    // question whose wrong answers are scenery tests nothing.
    g.order.length + (g.extra?.length ?? 0) >= 2 &&
    g.order.length >= 1 &&
    g.order.every(id => words.has(id)) &&
    isLearned(g.order[0], progress),
  )
}

/**
 * The extra bar 排序 has to clear: **every** member learned.
 *
 * Ranking three words by fit when one of them has never been met is not
 * discrimination practice — you would be ordering a stranger. Unlike 唤词
 * there is no way to route around it, because all three are the answer.
 */
export function isRankable(g: SenseGroup, progress: Progress): boolean {
  return g.order.every(id => isLearned(id, progress))
}

/**
 * The group's target, when it can actually be rendered: non-blank and
 * locating exactly once in the sentence. Anything else returns undefined
 * and the page shows the plain prompt — a wrong highlight (or one on two
 * places at once) is worse than none.
 */
const usableTarget = (g: SenseGroup): string | undefined => {
  const t = g.target?.trim()
  if (t === undefined || t === '') return undefined
  return g.zh.split(t).length - 1 === 1 ? t : undefined
}

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
 * gate already rejects a dangling index, and if one ever reaches the app the
 * right outcome is a slightly-off hint, not a question that fails to render.
 */
const hintFor = (w: Word, sense?: number): string | undefined => {
  const en = w.meanings[sense ?? 0]?.en ?? w.meanings[0]?.en
  return typeof en === 'string' && en.trim() !== '' ? en : undefined
}

/**
 * 唤词: the user has committed to a word in their head; these options find
 * out which one it was. The group's own members are the distractors that
 * matter (mistaking pervade for suffuse is the finding worth having), and
 * same-POS fillers top the set up to four so the group's size doesn't
 * telegraph the answer. Returns null when the library can't fill four
 * distinct options — a question with duplicate options must never ship.
 */
export function buildRecallQuestion(
  g: SenseGroup,
  words: Map<string, Word>,
  fillerPool: Word[],
  rng: () => number,
): RecallQuestion | null {
  const members = g.order.map(id => words.get(id))
  if (members.some(m => m === undefined)) return null
  const headwords = (members as Word[]).map(m => m.headword)
  const answer = headwords[0]
  const pos = (members as Word[])[0].meanings[0]?.pos ?? ''

  // Authored distractors first — members, then the outside confusables —
  // so fillers only ever top up what the group could not supply itself. A
  // filler is a random same-POS word; an authored rival is the question.
  const options = new Set([...headwords, ...(g.extra ?? [])])
  // Same POS only: an adjective among verbs is a free elimination, which
  // quietly refunds the commit gate's whole cost.
  const fillers = shuffle(
    fillerPool.filter(w => !options.has(w.headword) && (w.meanings[0]?.pos ?? '') === pos),
    rng,
  )
  for (const f of fillers) {
    if (options.size >= 4) break
    options.add(f.headword)
  }
  if (options.size < 4) return null

  return {
    kind: 'recall',
    prompt: g.zh,
    target: usableTarget(g),
    en: g.en,
    hint: hintFor((members as Word[])[0], g.sense),
    why: g.why,
    orderIds: [...g.order],
    memberHeadwords: headwords,
    options: shuffle([...options].slice(0, 4), rng),
    answer: [answer],
  }
}

/**
 * 排序: no fillers, no padding — the members themselves, shuffled, against
 * the authored order. Only groups of three or more qualify: ranking two
 * items is the same act as picking one, which 唤词 already tests.
 */
export function buildOrderQuestion(
  g: SenseGroup,
  words: Map<string, Word>,
  rng: () => number,
): RecallQuestion | null {
  if (g.order.length < 3) return null
  // A group carrying outside distractors is 唤词-only: they are not in the
  // library, so there is no authored ranking for them, and shuffling them
  // into a 排序 answer key would ask the learner to order words this app
  // never claims to teach.
  if ((g.extra?.length ?? 0) > 0) return null
  const members = g.order.map(id => words.get(id))
  if (members.some(m => m === undefined)) return null
  const headwords = (members as Word[]).map(m => m.headword)

  return {
    kind: 'order',
    prompt: g.zh,
    target: usableTarget(g),
    en: g.en,
    why: g.why,
    orderIds: [...g.order],
    memberHeadwords: headwords,
    options: shuffle(headwords, rng),
    answer: headwords,
  }
}

/**
 * Exact match, deliberately: three items give six permutations, so chance
 * is already 1/6, and the second-versus-third call is precisely the
 * judgment this mode exists to train. Partial credit would mostly reward
 * luck. (Spec: "Not doing — partial credit on 排序".)
 */
export function orderCorrect(tapped: string[], answer: string[]): boolean {
  return tapped.length === answer.length && tapped.every((t, i) => t === answer[i])
}

/**
 * Which words a miss marks wrong, following the contrast-mode precedent
 * (a missed contrast question marks both words): the confusion lives
 * *between* words, not in one of them.
 *
 * - 想不起来 (pick === null) → the answer only, for **both** kinds. At the
 *   commit gate the kind is still hidden, so the cost of answering
 *   honestly must not depend on which kind the card was about to become.
 * - 唤词 wrong pick → the answer and the word picked: those two were conflated.
 * - 排序 → every member whose position differs from the key. Swapping
 *   second and third marks those two and leaves the correctly-placed
 *   first alone — pulling its due forward would punish the part the user
 *   got right.
 */
export function wrongIdsFor(q: RecallQuestion, pick: string[] | null): string[] {
  if (pick === null) return [q.orderIds[0]]
  if (q.kind === 'recall') {
    const ids = new Set<string>([q.orderIds[0]])
    const picked = pick[0]
    if (picked !== undefined && picked !== q.memberHeadwords[0]) {
      // A filler pick maps to no member and marks nothing extra: the filler
      // was a random same-POS word, not a documented confusable — pulling
      // its due forward would punish a word for being drawn as scenery.
      const i = q.memberHeadwords.indexOf(picked)
      if (i !== -1) ids.add(q.orderIds[i])
    }
    return [...ids]
  }
  const tapped = pick ?? []
  return q.orderIds.filter((_, i) => tapped[i] !== q.answer[i])
}

/**
 * One session's worth of questions, alternating 唤词 / 排序 where the group
 * qualifies for both.
 *
 * Selection weights by the **maximum** difficultyWeight among members — a
 * group holding one struggling word is worth surfacing even when its other
 * members are easy — through the same weightedShuffle every other mode
 * draws with, so "trouble comes up more often" means one thing across the
 * app and no group is ever excluded outright.
 *
 * Three buckets, in order:
 *
 * 1. **`debt`** — groups the user pressed 巩固 on. This is the only
 *    mechanism that practises the *direction* they failed in: pulling the
 *    word's due date forward sends it to `/review`, whose card is headword
 *    on the front and meanings on the back — English→Chinese, the opposite
 *    of what was just missed. A zh→en failure has to come back as a zh→en
 *    question or it has not been reinforced at all.
 * 2. **unseen** — prompts the recency record has never shown.
 * 3. **`seen`** — demoted, never excluded, so an exhausted pool degrades to
 *    today's behaviour instead of an empty quiz.
 */
export function generateRecallSession(
  groups: SenseGroup[],
  words: Map<string, Word>,
  progress: Progress,
  today: string,
  seen: ReadonlySet<string>,
  debt: ReadonlySet<string>,
  count: number,
  rng: () => number,
): RecallQuestion[] {
  const eligible = eligibleGroups(groups, words, progress)
  const weight = (g: SenseGroup) =>
    Math.max(...g.order.map(id => {
      const w = words.get(id)
      return w === undefined ? 1 : difficultyWeight(w, progress, today)
    }))
  const drawn = weightedShuffle(eligible, weight, rng)
  // Stable partition into the three buckets above; each keeps its weighted
  // order within the bucket.
  const ordered = [
    ...drawn.filter(g => debt.has(g.zh)),
    ...drawn.filter(g => !debt.has(g.zh) && !seen.has(g.zh)),
    ...drawn.filter(g => !debt.has(g.zh) && seen.has(g.zh)),
  ]

  const fillerPool = [...words.values()].filter(w => {
    const e = progress.words[w.id]
    return e !== undefined && e.state !== 'new'
  })

  const out: RecallQuestion[] = []
  for (const g of ordered) {
    if (out.length >= count) break
    // Alternate the two kinds; fall back to the other when a group can't
    // carry the preferred one (a pair can't be ordered, a member is unlearned
    // so ranking is off the table, a sparse library can't fill four options)
    // rather than dropping the group.
    const rankable = isRankable(g, progress)
    const q = rankable && out.length % 2 === 1
      ? buildOrderQuestion(g, words, rng) ?? buildRecallQuestion(g, words, fillerPool, rng)
      : buildRecallQuestion(g, words, fillerPool, rng)
        ?? (rankable ? buildOrderQuestion(g, words, rng) : null)
    if (q !== null) out.push(q)
  }
  return out
}
