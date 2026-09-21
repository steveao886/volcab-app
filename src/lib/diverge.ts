import { buildAntonymPairs } from './antonym'
import { isInflectionOf } from './headword'
import { shuffle } from './quiz'
import { recentWindow } from './passage'
import type { Progress, Word } from '../types'

/**
 * 发散 — one Chinese concept, produce every English word around it.
 *
 * Every other Chinese-to-English surface asks for **one** word: 回想 shows a
 * scenario and you tap it, 组句 shows a frame and you supply it. This one asks
 * for the whole neighbourhood, along four different paths out of the same
 * starting point — near-synonyms, the opposite, another part of speech, the
 * negated form.
 *
 * Everything here is pure; the page paints what these functions decide.
 * See docs/superpowers/specs/2026-09-18-diverge-mode-design.md.
 */

export const DIVERGE_AXES = ['synonym', 'opposite', 'pos', 'negation'] as const
export type DivergeAxis = (typeof DIVERGE_AXES)[number]

/**
 * The floor on an answer set. **Fail closed**: a 发散 question with two
 * answers is not a 发散 question, it is a 回想 question with extra typing.
 */
export const MIN_ANSWERS = 3

/**
 * An authored concept. The Chinese prompt and the anchors are written by
 * hand; the membership is not.
 *
 * `anchors` are synonym *keys* — strings that appear in library words'
 * `synonyms` arrays — and the members are whatever currently lists them.
 * That indirection is the whole design: a word added next month whose
 * synonyms mention `stubborn` joins 固执 the moment it lands, with nothing
 * re-authored. Copying the member ids in here instead would freeze the
 * concept at the day it was written (CLAUDE.md: store indices into content,
 * not copies of it).
 *
 * The price is that a bucket carries noise — `promulgate` and `metastasize`
 * share `disseminate` — which is what `exclude` is for.
 */
export interface Concept {
  id: string
  /** The prompt, Chinese only. It is on screen before any answer, so a single Latin letter is a leak. */
  zh: string
  /** Synonym keys whose buckets make up this concept. */
  anchors: string[]
  /** Member ids the anchors drag in that do not belong. */
  exclude?: string[]
  /**
   * Library ids that must not be offered as this concept's **opposite**,
   * though a member does list them.
   *
   * An antonym hangs off a *word*, not off the sense of the word that put it
   * in this concept, so the 反面 axis is where a member's second meaning
   * surfaces. The case that produced this field: 一路不松劲,压力再大也不改口
   * drew `relentless` through its 坚定 sense, and `relentless`'s antonyms are
   * written for its other one — 持续不断 — so the question asked for the
   * opposite of "不改口" and accepted `intermittent` and `sporadic`. Two of
   * its three answers were about a sense the prompt never named.
   *
   * Read over all 25 opposite questions askable in September 2026, 9 carried
   * at least one answer like that and in 4 the strays were the majority. The
   * repeat offenders are single words with two lives — `relentless`,
   * `reactive`, `callous`, `ostentatious`, `agreeable`, `inert` — which is
   * why the fix is a denylist of answers rather than of members: `relentless`
   * is a perfectly good 近义 for 不松劲 and only misleads in this direction.
   *
   * **Not a quorum rule.** "Require two members to name the antonym" was
   * measured first and it guts the axis: 24 of those 25 questions have a
   * single-member answer and most are correct (`cursory` from `meticulous`,
   * `placid` from `irritable`).
   *
   * A question that falls below MIN_ANSWERS once its strays are removed
   * simply stops being asked, which is the right failure — see the module
   * header on failing closed.
   */
  excludeOpposites?: string[]
  /**
   * Library ids that are this concept's morphologically negated form.
   *
   * **Hand-written, and it has to be.** Only 14 prefix/base pairs have both
   * sides in the library, so membership cannot supply this; and spelling
   * cannot either — a "starts with un/in/im/ir/il/dis" heuristic run over the
   * learned words returned 7 false positives in a 15-word sample
   * (`understated` and `underhand` are `under-`, `irritation` is not
   * `ir-`+`ritation`, plus `disputatious`, `annoyance`, `acrimonious`,
   * `argumentative`). The library also holds the semantic traps: `ingenious`
   * is not "not genious", `impassioned` takes an intensive `im-`.
   *
   * Same call `Word.etymology` makes: a derivation that is 90% right plants a
   * false rule with full confidence.
   */
  negations?: string[]
}

/** One thing the learner may produce. */
export interface DivergeAnswer {
  /** The surface to type. */
  form: string
  /** The library word this hangs off — the member itself, or the base of a related form. */
  wordId: string
  /**
   * True when `form` is not a library headword.
   *
   * Only 256 of the library's 1,157 `relatedForms` entries are library words
   * in their own right, so restricting 换词性 to library words left it with
   * **one** askable question in the whole library. It grades against the
   * authored form directly instead; this flag is how the page knows there is
   * no word detail page to link to.
   */
  derived: boolean
  /** Listed in the concept's `negations`. Read by grading rule 5. */
  negated: boolean
}

export interface DivergeQuestion {
  axis: DivergeAxis
  conceptId: string
  /** The concept's Chinese prompt, verbatim. The axis instruction is the page's to render. */
  zh: string
  /** Set on the `pos` axis only: the part of speech being asked for, e.g. `n.`. */
  pos?: string
  answers: DivergeAnswer[]
}

/**
 * What one submission was.
 *
 * `otherWord` and `outside` are both **neutral** — neither a hit nor a miss.
 * Marking a real English synonym wrong because it is not in this library
 * makes the app look stupid; counting it makes the denominator meaningless.
 */
export type Verdict =
  | { kind: 'hit'; form: string; wordId: string; typo: boolean }
  | { kind: 'already'; form: string }
  | { kind: 'otherWord'; wordId: string }
  | { kind: 'prefix'; form: string; wordId: string }
  | { kind: 'outside' }

export interface ConceptIndex {
  /** Synonym key → ids of the words listing it. */
  buckets: Map<string, Set<string>>
  /** Id → library ids that are its opposite, in both authoring directions. */
  opposites: Map<string, Set<string>>
  /** Normalized headword → id. Rule 3 reads this. */
  byHeadword: Map<string, string>
  byId: Map<string, Word>
}

const norm = (s: string) => s.trim().toLowerCase()

export function buildConceptIndex(words: Word[]): ConceptIndex {
  const buckets = new Map<string, Set<string>>()
  const byHeadword = new Map<string, string>()
  const byId = new Map<string, Word>()

  for (const w of words) {
    byId.set(w.id, w)
    byHeadword.set(norm(w.headword), w.id)
    // The id is a lowercase lemma and usually equals the headword, but not
    // always (multi-word entries). Both spellings must resolve, or rule 3
    // leaks: a real entry typed by its id would be read as a typo.
    byHeadword.set(norm(w.id), w.id)
    for (const raw of w.synonyms) {
      const k = norm(raw)
      // A blank synonym would otherwise collect every word that has one, the
      // same trap contrast.ts and antonym.ts both guard.
      if (k === '') continue
      const set = buckets.get(k)
      if (set) set.add(w.id)
      else buckets.set(k, new Set([w.id]))
    }
  }

  const opposites = new Map<string, Set<string>>()
  const link = (from: string, to: string) => {
    const set = opposites.get(from)
    if (set) set.add(to)
    else opposites.set(from, new Set([to]))
  }
  // Reuses antonym.ts's pair graph rather than re-deriving it, so 发散 and the
  // 反义 quiz can never disagree about what an opposite is. A one-way pair
  // counts in both directions there for a reason worth keeping: the asymmetry
  // is authoring, not meaning.
  for (const p of buildAntonymPairs(words)) {
    link(p.a, p.b)
    link(p.b, p.a)
  }

  return { buckets, opposites, byHeadword, byId }
}

/** ⋃ anchor buckets ∩ learned − exclude, sorted so a round is reproducible. */
export function conceptMembers(concept: Concept, index: ConceptIndex, learned: ReadonlySet<string>): string[] {
  const excluded = new Set(concept.exclude ?? [])
  const out = new Set<string>()
  for (const anchor of concept.anchors) {
    for (const id of index.buckets.get(norm(anchor)) ?? []) {
      if (!excluded.has(id) && learned.has(id)) out.add(id)
    }
    // An anchor that is itself a library entry belongs to its own concept —
    // a word does not list itself in `synonyms`, so without this the anchor
    // word would be the one member silently missing from its own question.
    const self = index.byHeadword.get(norm(anchor))
    if (self !== undefined && !excluded.has(self) && learned.has(self)) out.add(self)
  }
  return [...out].sort()
}

export const learnedIds = (progress: Progress): Set<string> =>
  new Set(Object.entries(progress.words).filter(([, e]) => e.state !== 'new').map(([id]) => id))

/**
 * Never the asked part of speech.
 *
 * Producing `imperiously` from `imperious` is a suffix, not a retrieval, and
 * this mode is about retrieval. Costs 3 of 46 otherwise-qualifying clusters.
 */
const NEVER_ASKED_POS = 'adv.'

export function buildQuestion(
  concept: Concept,
  axis: DivergeAxis,
  index: ConceptIndex,
  progress: Progress,
): DivergeQuestion | null {
  const learned = learnedIds(progress)
  const members = conceptMembers(concept, index, learned)
  if (members.length === 0) return null

  const negated = new Set(concept.negations ?? [])
  const base = { axis, conceptId: concept.id, zh: concept.zh }
  const asAnswer = (id: string): DivergeAnswer | null => {
    const w = index.byId.get(id)
    // The live library is authoritative and the user deletes words in the app,
    // so an authored id may simply be gone. Skip it; never throw.
    if (!w) return null
    return { form: norm(w.headword), wordId: id, derived: false, negated: negated.has(id) }
  }
  const done = (answers: DivergeAnswer[], pos?: string): DivergeQuestion | null =>
    answers.length >= MIN_ANSWERS ? { ...base, ...(pos ? { pos } : {}), answers } : null

  if (axis === 'synonym') {
    return done(members.map(asAnswer).filter((a): a is DivergeAnswer => a !== null))
  }

  if (axis === 'opposite') {
    const own = new Set(members)
    // Hand-vetted strays: see Concept.excludeOpposites.
    const banned = new Set(concept.excludeOpposites ?? [])
    const ids = new Set<string>()
    for (const m of members) {
      for (const o of index.opposites.get(m) ?? []) {
        if (!own.has(o) && !banned.has(o) && learned.has(o)) ids.add(o)
      }
    }
    return done([...ids].sort().map(asAnswer).filter((a): a is DivergeAnswer => a !== null))
  }

  if (axis === 'negation') {
    const ids = (concept.negations ?? []).filter(id => learned.has(id)).sort()
    return done(ids.map(asAnswer).filter((a): a is DivergeAnswer => a !== null))
  }

  // pos — the family is the members plus their related forms. A synonym
  // cluster is part-of-speech homogeneous by construction (synonyms of an
  // adjective are adjectives), so without the related forms there is no
  // second part of speech to ask for at all.
  const byPos = new Map<string, DivergeAnswer[]>()
  const push = (pos: string, a: DivergeAnswer) => {
    const list = byPos.get(pos)
    if (list) list.push(a)
    else byPos.set(pos, [a])
  }
  const seen = new Set<string>()
  for (const id of members) {
    const w = index.byId.get(id)
    if (!w) continue
    const self = asAnswer(id)
    if (self && !seen.has(self.form)) { seen.add(self.form); push(w.meanings[0].pos, self) }
    for (const f of w.relatedForms) {
      const form = norm(f.form)
      if (form === '' || seen.has(form)) continue
      seen.add(form)
      push(f.pos, { form, wordId: id, derived: index.byHeadword.get(form) === undefined, negated: negated.has(id) })
    }
  }
  if (byPos.size < 2) return null
  let dominant = ''
  for (const [pos, list] of byPos) {
    if (dominant === '' || list.length > (byPos.get(dominant)?.length ?? 0)) dominant = pos
  }
  const candidates = [...byPos.entries()]
    .filter(([pos, list]) => pos !== dominant && pos !== NEVER_ASKED_POS && list.length >= MIN_ANSWERS)
    // Most answers first, then alphabetically: the draw must not depend on
    // Map insertion order, which follows the order words happen to sit in.
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  const pick = candidates[0]
  if (!pick) return null
  return done([...pick[1]].sort((a, b) => a.form.localeCompare(b.form)), pick[0])
}

/**
 * Negation prefixes, longest first so `dis`/`non` are not shadowed.
 *
 * This list only ever *compares* two spellings against each other. It never
 * decides that a word is a negation — see `Concept.negations` for why nothing
 * may.
 */
const NEG_PREFIXES = ['dis', 'non', 'un', 'in', 'im', 'ir', 'il'] as const

function negSplit(s: string): { prefix: string; rest: string } | null {
  for (const p of NEG_PREFIXES) {
    // A 4-character floor on the remainder, so `iron` is not read as
    // `ir` + `on` and `into` as `in` + `to`.
    if (s.startsWith(p) && s.length - p.length >= 4) return { prefix: p, rest: s.slice(p.length) }
  }
  return null
}

/**
 * One edit away: a substitution, an insertion, a deletion, **or a swap of two
 * adjacent letters**.
 *
 * The transposition is not a flourish. Plain Levenshtein scores a swap as two
 * edits (a delete plus an insert), so the single commonest typing slip there
 * is — `grumbel` for `grumble`, `teh` for `the` — fell straight through the
 * tolerance this whole rule exists to provide. Caught by playing the mode, not
 * by a test.
 *
 * Counting it as one edit costs nothing measurable: over the 931-word library
 * the transposition-aware distance finds **the same 14 pairs** at distance 1
 * as plain Levenshtein — not one word pair in the library is a transposition
 * of another — and still **zero** pairs inside any one answer set. So the
 * looser rule cannot credit a different member of the set being asked.
 */
function within1(a: string, b: string): boolean {
  if (a === b) return false
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false

  if (la === lb) {
    const diff: number[] = []
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && diff.push(i) > 2) return false
    }
    if (diff.length === 1) return true
    // Adjacent, and each letter is the other's — anything else is two
    // substitutions, which is two edits however it reads.
    return diff.length === 2
      && diff[1] === diff[0] + 1
      && a[diff[0]] === b[diff[1]]
      && a[diff[1]] === b[diff[0]]
  }

  const long = la > lb ? a : b
  const short = la > lb ? b : a
  let i = 0
  let j = 0
  let skipped = false
  while (i < long.length && j < short.length) {
    if (long[i] === short[j]) { i++; j++; continue }
    if (skipped) return false
    skipped = true
    i++
  }
  return true
}

/**
 * Grade one submission. **The rule order is the contract**, not an
 * implementation detail:
 *
 * 1. exact → hit
 * 2. the input is itself a library headword → judged on its own, **never** as
 *    a typo of an answer. This one rule disposes of all 14 library pairs at
 *    edit distance 1 (`swindle`/`dwindle`, `disparate`/`disparage`,
 *    `inert`/`inept`, `gratify`/`ratify`, `nuance`/`nuanced` …): answer
 *    `dwindle` and input `swindle` is not a slip, it is the wrong word.
 * 3. an inflection of an answer → hit
 * 4. **a wrong negation prefix → reported, never forgiven.** `inprudent` is
 *    one edit from `imprudent`; without this rule the next one swallows it,
 *    and it is the only thing 加否定 tests.
 * 5. edit distance 1 → hit, flagged
 * 6. anything else → neutral
 *
 * Distance 1 is safe here, measured rather than assumed: across the 215
 * synonym buckets with 3+ members there are **zero** pairs at edit distance 1
 * inside one answer set (6 at distance 2, four of them same-root morphology),
 * against 14 such pairs in the whole 432,915-pair library.
 */
export function gradeInput(
  raw: string,
  question: DivergeQuestion,
  index: ConceptIndex,
  found: ReadonlySet<string>,
): Verdict {
  const s = norm(raw)
  if (s === '') return { kind: 'outside' }

  const hit = (a: DivergeAnswer, typo: boolean): Verdict =>
    found.has(a.form) ? { kind: 'already', form: a.form } : { kind: 'hit', form: a.form, wordId: a.wordId, typo }

  const exact = question.answers.find(a => a.form === s)
  if (exact) return hit(exact, false)

  const other = index.byHeadword.get(s)
  if (other !== undefined) return { kind: 'otherWord', wordId: other }

  const inflected = question.answers.find(a => isInflectionOf(s, a.form))
  if (inflected) return hit(inflected, false)

  const typed = negSplit(s)
  if (typed) {
    const swapped = question.answers.find(a => {
      if (!a.negated) return false
      const want = negSplit(a.form)
      return want !== null && want.rest === typed.rest && want.prefix !== typed.prefix
    })
    if (swapped) return { kind: 'prefix', form: swapped.form, wordId: swapped.wordId }
  }

  const near = question.answers.find(a => within1(s, a.form))
  if (near) return hit(near, true)

  return { kind: 'outside' }
}

/**
 * How many question keys the local recency list keeps.
 *
 * **Not pushRecent's default of 60**, which is the passage corpus size and
 * would silently truncate a window computed over a larger pool - the bug
 * RECALL_RECENT_LIMIT exists for. The windows this mode wants sum to about
 * 100 today (54 + 26 + 16 + 4 over pools of 81 / 40 / 25 / 6), and the whole
 * askable pool can never exceed one question per concept per axis - 328 at
 * 82 concepts. 400 keeps the cap from ever being the binding constraint, and
 * costs ~9 KB beside a progress cache measured at 190 KB.
 */
export const DIVERGE_RECENT_LIMIT = 400

/**
 * A question's identity: one per concept per axis, because buildQuestion
 * yields at most one question for that pair (the pos axis picks a single
 * part of speech, `candidates[0]`). The same string keys `Progress.diverge`
 * and the local recency list, and it is exported so the three of them cannot
 * drift apart by being spelled out separately.
 */
export const divergeKey = (q: { conceptId: string; axis: DivergeAxis }): string => `${q.conceptId}|${q.axis}`

/**
 * Shuffles one axis's pool, then sinks anything asked recently behind
 * everything that was not.
 *
 * **发散 was the only content-pool mode with no memory of what it had
 * asked.** Every round reshuffled all four pools and took the top slice, so
 * repeats were pure chance — measured on the live library (152 askable
 * questions, 931 words): over a 7-round sitting only 47 of the 56 questions
 * asked were distinct, and 79% of rounds after the first contained a
 * question already seen that sitting. 加否定 was worst at 37%, because its
 * pool holds 6 and the allocation hands it a slot every round.
 *
 * The window is `recentWindow` — two thirds of the pool — and it is taken
 * **per axis**, over this axis's own entries in the list. A shared window
 * would be spent by 近义's 81 questions before 加否定's 6 saw any of it, and
 * the allocation below is per axis, so the window has to be too.
 *
 * Two thirds rather than everything, for the reason recentWindow was
 * written: the last third is where the shuffle still gets to choose, so a
 * fully-played pool keeps cycling instead of locking into a fixed order.
 *
 * Re-measured over the same 7-round sitting with the window in place:
 * repeats 16.7% -> 2.3%, distinct questions 47 -> 55 of 56, and rounds
 * containing a repeat 75% -> 22%. 近义, 反面 and 词性 each reach 0%; the
 * whole remainder is 加否定 at 19%, whose pool is 6 and whose window is
 * therefore 4, so it wraps every three rounds. That one is a content
 * shortage, not a draw defect - no ordering rule can make a seventh
 * question out of six.
 *
 * Not `Progress.diverge[key].lastAt`, which records the same thing and is
 * synced: recordDiverge only fires when a whole round is finished, so a
 * round quit halfway leaves no trace. Measured on the live progress.json —
 * 15 questions recorded against a day of play. A list written per question
 * answered sees them all; the price is that it stays on one device, which
 * is the trade every other recency list here already makes (lib/storage.ts).
 */
function demoteSeen(pool: DivergeQuestion[], recent: readonly string[], rng: () => number): DivergeQuestion[] {
  const shuffled = shuffle(pool, rng)
  if (pool.length === 0) return shuffled
  const mine = new Set(pool.map(divergeKey))
  // Keys for questions this axis cannot ask — a retired concept, a deleted
  // word — are dropped before the window is measured, so a stale list never
  // spends the window of the questions that still exist.
  const window = new Set(recent.filter(k => mine.has(k)).slice(0, recentWindow(pool.length)))
  if (window.size === 0) return shuffled
  return [
    ...shuffled.filter(q => !window.has(divergeKey(q))),
    ...shuffled.filter(q => window.has(divergeKey(q))),
  ]
}

/**
 * One round, axes mixed.
 *
 * The mixing **is** the exercise — eight 近义 questions in a row train one
 * path, and the user asked for "锻炼思维脑回路", which is the switching. So
 * every axis that can be asked gets at least one slot, which a weighted draw
 * alone would not guarantee.
 *
 * **The remaining slots go by pool size, and that part is not decoration.**
 * A flat round-robin was the first implementation, and measured over the 82
 * authored concepts it misbehaves visibly: the axes hold 82 / 47 / 31 / 6
 * questions, so equal slots spend a quarter of every round on the 6-question
 * 加否定 pool — you see all six within three rounds while the 82 近义 questions
 * rotate four times slower. Across 30 rounds a flat draw reached only **101 of
 * the 166** askable questions. Proportional-after-the-floor keeps all four
 * axes on screen and stops the thinnest one from dominating.
 */
export function generateDivergeSession(
  concepts: Concept[],
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
  /** Question keys most recently asked, newest first — see demoteSeen. Empty draws exactly as this did before the window existed. */
  recent: readonly string[] = [],
): DivergeQuestion[] {
  const index = buildConceptIndex(words)
  const byAxis = new Map<DivergeAxis, DivergeQuestion[]>(DIVERGE_AXES.map(a => [a, []]))
  for (const c of concepts) {
    for (const axis of DIVERGE_AXES) {
      const q = buildQuestion(c, axis, index, progress)
      if (q) byAxis.get(axis)!.push(q)
    }
  }
  for (const axis of DIVERGE_AXES) byAxis.set(axis, demoteSeen(byAxis.get(axis)!, recent, rng))

  const live = DIVERGE_AXES.filter(a => byAxis.get(a)!.length > 0)
  if (live.length === 0) return []

  // One each first, so a thin axis is never crowded out entirely.
  const slots = new Map<DivergeAxis, number>(live.map(a => [a, 0]))
  let spent = 0
  for (const axis of live) {
    if (spent >= count) break
    slots.set(axis, 1)
    spent += 1
  }

  // The rest by highest averages: each remaining slot goes to whichever axis
  // has the largest pool per slot it already holds. An axis that has been
  // handed its whole pool scores zero and drops out, so leftovers flow to the
  // deep pools by the same rule rather than by a separate top-up — which is
  // what an earlier largest-remainder version needed, and that top-up quietly
  // did the proportioning while the apportionment itself was dead code.
  while (spent < count) {
    let pick: DivergeAxis | null = null
    let best = 0
    for (const axis of live) {
      const room = byAxis.get(axis)!.length - slots.get(axis)!
      if (room <= 0) continue
      const score = byAxis.get(axis)!.length / (slots.get(axis)! + 1)
      if (score > best) { best = score; pick = axis }
    }
    if (!pick) break
    slots.set(pick, slots.get(pick)! + 1)
    spent += 1
  }

  // Interleaved rather than grouped: the switching has to happen question to
  // question, not in blocks of three.
  const out: DivergeQuestion[] = []
  let drained = false
  while (out.length < count && !drained) {
    drained = true
    for (const axis of live) {
      if (slots.get(axis)! <= 0) continue
      const q = byAxis.get(axis)!.shift()
      if (!q) continue
      slots.set(axis, slots.get(axis)! - 1)
      drained = false
      out.push(q)
      if (out.length === count) break
    }
  }
  return out
}
