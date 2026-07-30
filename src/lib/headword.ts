/**
 * Locates the headword (including inflected forms) within a sentence.
 *
 * This algorithm originally lived inside quiz.ts's cloze questions, and grew out of what
 * was measured there: across 476 words' example sentences, 86% contain the headword's base
 * form, 14% contain only an inflected form (concocted / concocting), and 0% can't be
 * located at all — matching only the exact word would miss 68 words. Since cloze and
 * highlighting are looking for the same thing, there shouldn't be two separate
 * implementations.
 */

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** English inflectional suffixes. Enumerated rather than `[a-z]*` — see tightPattern for why. */
const SUFFIX = '(?:e|y|s|d|es|ed|ly|ies|ied|ing|ying|ings|ers|er|est)?'

/**
 * The tight rule used when the base form is present: strip a trailing e/y from the
 * headword, then allow only one genuine inflectional suffix after it.
 *
 * Why not `[a-z]*` or `[a-z]{0,3}`:
 * - `mire`'s stem `mir` would hit **mirth**;
 * - `officiate`'s stem would hit **officials**;
 * - `dystrophy` would hit **dystrophin**.
 * Enumerating the suffixes blocks all of these. Measured across the full library — 476
 * words / 1251 marked occurrences — switching to enumeration produced **zero losses, zero
 * false hits, and only 1 additional marked occurrence** — and that one occurrence is exactly
 * the missed question described below.
 *
 * By construction this is guaranteed to match the base form itself (base strips at most one
 * trailing e/y, and the suffix set includes e, y, and empty).
 */
const tightPattern = (h: string): RegExp => {
  const base = /[ey]$/.test(h) ? h.slice(0, -1) : h
  return new RegExp(`\\b${escapeRe(base)}${SUFFIX}\\b`, 'gi')
}

/** Between the words of a multi-word headword. Hyphens count, so an example writing "ad-hoc" still matches the headword "ad hoc". */
const WORD_SEP = '[\\s-]+'

/**
 * The stems an inflected form of a single word could be built from — the same
 * three-base rule isInflectionOf documents at length: the word itself, the
 * word with a trailing e/y stripped, and the word with its final consonant
 * doubled under the standard CVC condition.
 *
 * Longest first, so the regex engine tries `putt` before `put` and doesn't
 * lean on backtracking to find `putting`.
 */
function inflectableStems(w: string): string[] {
  const bases = [w]
  if (/[ey]$/.test(w)) bases.push(w.slice(0, -1))
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(w)) bases.push(w + w.slice(-1))
  return bases.sort((a, b) => b.length - a.length)
}

/**
 * Matcher for a headword made of several words — a phrasal verb, an idiom, a
 * fixed expression.
 *
 * **Only the first word inflects, and the words must be adjacent.** Both
 * restrictions are deliberate:
 *
 * - Inflection lands on the first word because that is where English puts it
 *   in every shape this has to handle: puts/putting off, comes down to,
 *   kicked the can down the road.
 * - Separated particles ("put the meeting off") are **not** matched, and that
 *   is the whole reason this function exists. The single-word loose fallback
 *   below turns `put off` into the stem `put ` and then happily matches
 *   `put the` in that sentence, producing the cloze "He ___ meeting off twice
 *   in one week" — a question with the blank in the wrong place and a
 *   stranded particle. A false hit is worse than a miss here: a miss just
 *   drops one candidate sentence, while a false hit ships a broken question
 *   that no validator catches. So multi-word headwords never fall back to the
 *   loose rule — if the contiguous form isn't there, this returns null and
 *   the sentence is simply not used.
 */
/**
 * Irregular past and participle forms, keyed by base verb.
 *
 * Needed because phrasal verbs are built almost entirely out of the small set
 * of everyday verbs, and in English those are precisely the irregular ones —
 * suffix rules can spell `putting off` but never `came down to` or `sat on`.
 * Two of the first ten phrasal verbs tried against the suffix-only rule
 * failed for exactly this reason.
 *
 * **Consulted only for the first word of a multi-word headword.** Single-word
 * headwords deliberately keep the rules that were measured at zero losses and
 * zero false hits over the whole library; widening them here would put that
 * result at risk to solve a problem single words don't have.
 *
 * Present participles are absent on purpose — those are regular (+ing, with
 * the CVC doubling inflectableStems already applies).
 */
const IRREGULAR_FORMS: Record<string, string[]> = {
  back: [], bear: ['bore', 'borne'], beat: ['beat', 'beaten'], become: ['became'],
  begin: ['began', 'begun'], bend: ['bent'], blow: ['blew', 'blown'], break: ['broke', 'broken'],
  bring: ['brought'], build: ['built'], buy: ['bought'], catch: ['caught'],
  come: ['came'], cut: ['cut'], deal: ['dealt'], do: ['did', 'done', 'does'],
  draw: ['drew', 'drawn'], drive: ['drove', 'driven'], fall: ['fell', 'fallen'],
  feel: ['felt'], fight: ['fought'], find: ['found'], fly: ['flew', 'flown'],
  get: ['got', 'gotten'], give: ['gave', 'given'], go: ['went', 'gone', 'goes'],
  grow: ['grew', 'grown'], hang: ['hung'], have: ['had', 'has'], hear: ['heard'],
  hold: ['held'], keep: ['kept'], know: ['knew', 'known'], lay: ['laid'],
  lead: ['led'], leave: ['left'], lend: ['lent'], let: ['let'], lie: ['lay', 'lain'],
  light: ['lit'], lose: ['lost'], make: ['made'], meet: ['met'], pay: ['paid'],
  put: ['put'], read: ['read'], ride: ['rode', 'ridden'], ring: ['rang', 'rung'],
  rise: ['rose', 'risen'], run: ['ran', 'run'], say: ['said'], see: ['saw', 'seen'],
  sell: ['sold'], send: ['sent'], set: ['set'], shake: ['shook', 'shaken'],
  shoot: ['shot'], show: ['showed', 'shown'], shut: ['shut'], sit: ['sat'],
  sleep: ['slept'], speak: ['spoke', 'spoken'], spend: ['spent'], spin: ['spun'],
  stand: ['stood'], stick: ['stuck'], strike: ['struck'], sweep: ['swept'],
  swing: ['swung'], take: ['took', 'taken'], teach: ['taught'], tear: ['tore', 'torn'],
  tell: ['told'], think: ['thought'], throw: ['threw', 'thrown'], wear: ['wore', 'worn'],
  win: ['won'], wind: ['wound'], write: ['wrote', 'written'],
}

/** Every surface form the head of a phrase can take: regular suffixing off its stems, plus any irregular forms. */
function headForms(w: string): string {
  const regular = `(?:${inflectableStems(w).map(escapeRe).join('|')})${SUFFIX}`
  const irregular = (IRREGULAR_FORMS[w] ?? []).map(escapeRe)
  return `(?:${[regular, ...irregular].join('|')})`
}

function phrasePattern(parts: string[]): string {
  const rest = parts.slice(1).map(escapeRe).join(WORD_SEP)
  return `\\b${headForms(parts[0])}${WORD_SEP}${rest}\\b`
}

/**
 * Returns a global regex matching every occurrence in the sentence; returns null if it
 * can't be located.
 *
 * Multi-word headwords take phrasePattern above and stop there. Single words keep the
 * original two stages:
 * 1. **Base form present** → use the tight rule, so the base form and its inflected forms
 *    are matched together. This stage exists to fix a real missed question: placate's
 *    example sentence is "to placate passengers…, which **placated** almost no one" —
 *    originally only the base form was blanked out, leaving the inflected form still
 *    sitting in the sentence and giving away the answer for free. That's exactly the
 *    scenario the "blank out every occurrence in the same sentence" comment in quiz.ts was
 *    meant to guard against, except it never covered inflected forms.
 * 2. **Only an inflected form present** (measured at 14%, e.g. concocted / concocting) →
 *    fall back to a loose stem match, to preserve 100% locate coverage. The loose rule can
 *    cause false hits, but it only runs when the base form is absent, and measured across
 *    the full library it has never produced an actual false hit.
 */
export function headwordPattern(sentence: string, headword: string): RegExp | null {
  const h = headword.trim().toLowerCase()
  if (h === '') return null

  const parts = h.split(/\s+/)
  if (parts.length > 1) {
    const src = phrasePattern(parts)
    // Fresh objects for the same reason as below: test() with the g flag moves lastIndex.
    return new RegExp(src, 'i').test(sentence) ? new RegExp(src, 'gi') : null
  }

  // test() with the g flag advances lastIndex, so probing and returning each use their own
  // regex object to avoid interfering with each other
  if (new RegExp(`\\b${escapeRe(h)}\\b`, 'i').test(sentence)) return tightPattern(h)

  const stem = h.length > 5 ? h.slice(0, h.length - 3) : h
  const loose = new RegExp(`\\b${escapeRe(stem)}[a-z]*\\b`, 'gi')
  return loose.test(sentence) ? new RegExp(loose.source, 'gi') : null
}

/**
 * Whether `surface` is an inflected form of `headword`.
 *
 * **Does not use headwordPattern's loose fallback.** That fallback (`stem + [a-z]*`) exists
 * to locate a headword within a whole sentence; when validating a single word it would
 * judge `reference` to be an inflected form of `refute`, and `mirth` an inflected form of
 * `mire`. During validation there's only one candidate word, so there's no "missed question
 * if we can't locate it" pressure — this should use strict suffix enumeration instead.
 *
 * **Deliberately looser than tightPattern.** tightPattern has to scan across a whole
 * sentence, where getting the base wrong by even one character can accidentally hit some
 * unrelated word elsewhere in the sentence; here it's only checking one known headword
 * against one candidate word, with no "scanning a whole sentence" blast radius, so it can
 * afford to try three candidate bases — matching counts as long as any one of them, combined
 * as `base + SUFFIX`, equals surface:
 *
 * 1. The headword itself, untrimmed — this covers `-ly` attached directly after a headword
 *    ending in e (profuse→profusely, unobtrusive→unobtrusively: SUFFIX already includes
 *    `ly`, but the old code stripped the headword's e first, and `profus`+`ly` can't spell
 *    `profusely`), as well as cases where a headword ending in "vowel + y" shouldn't have
 *    its y stripped (convey→conveyed/conveys — stripped down to `conve`, these two forms
 *    could never match before).
 * 2. The headword with its trailing e/y stripped (the original rule) — keeps refuted,
 *    ratified working.
 * 3. The headword with its final consonant doubled, only when the headword ends in
 *    "consonant + vowel + consonant" and the final consonant isn't w/x/y (the standard
 *    English doubling condition) — covers manumit→manumitted, concur→concurred,
 *    extol→extolled/extolling. This condition is restricted so as not to invent a base out
 *    of thin air for words that don't double.
 *
 * Measured (across the full library of 471 words, using splitByHeadword to pull the actual
 * inflected forms that occur in each word's own example sentences — 2356 occurrences total):
 * before adding the three bases, 18 occurrences were judged not to be inflected forms, and
 * 13 of those were **genuine inflected forms wrongly rejected** (6 distinct combinations
 * after dedup: manumit→manumitted, concur→concurred, extol→extolled/extolling,
 * profuse→profusely, unobtrusive→unobtrusively). manumit was especially bad — its base form
 * never appears in its own example sentences at all, so all 5 sentences failed, and the
 * validation script would have judged the word entirely unusable.
 *
 * After the fix only 5 rejections remain, and those 5 are exactly the true false-positives
 * caused by headwordPattern's loose fallback (preside→president, sapient→sapiens,
 * indict→industry, allude→all, introspection→introspective) — they **should** be rejected,
 * and the new rules didn't loosen anything for them; the CVC doubling restriction doesn't
 * let their stems spell out these words either. Scanning all 471×470 headword pairs, there
 * is exactly 1 false positive (precipitous ← precipitously), and that pair is genuinely a
 * cognate adjective/adverb, so judging it true is fine.
 *
 * SUFFIX and tightPattern are both untouched: the two are shared, and tightPattern is also
 * responsible for choosing what gets blanked out / highlighted during a full-sentence scan
 * — loosening it would silently change cloze behavior site-wide. This function only does a
 * one-off word-to-word check, so a rule like consonant doubling is safe enough to add here,
 * which isn't necessarily true if added to tightPattern.
 *
 * Used only by the write-side validation script (scripts/validate-passages.ts).
 */
export function isInflectionOf(surface: string, headword: string): boolean {
  const s = surface.trim().toLowerCase()
  const h = headword.trim().toLowerCase()
  if (s === '' || h === '') return false
  if (s === h) return true

  // A multi-word headword is checked whole, by the same contiguous rule the
  // sentence scan uses, so the two can't disagree about what counts as an
  // occurrence of "put off".
  const parts = h.split(/\s+/)
  if (parts.length > 1) return new RegExp(`^${phrasePattern(parts)}$`, 'i').test(s)

  return inflectableStems(h).some(base => new RegExp(`^${escapeRe(base)}${SUFFIX}$`, 'i').test(s))
}

export interface Segment { text: string; hit: boolean }

/**
 * Splits a sentence into segments by headword, with `hit` marking the matched ones, for the
 * rendering layer to wrap in <mark>. Returns the whole sentence as a single segment
 * (hit=false) when it can't be located — highlighting is a nice-to-have, and a failed
 * locate shouldn't stop the example sentence from being shown.
 */
export function splitByHeadword(sentence: string, headword: string): Segment[] {
  const re = headwordPattern(sentence, headword)
  if (re === null) return [{ text: sentence, hit: false }]

  const out: Segment[] = []
  let last = 0
  for (const m of sentence.matchAll(re)) {
    if (m.index > last) out.push({ text: sentence.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < sentence.length) out.push({ text: sentence.slice(last), hit: false })
  return out
}
