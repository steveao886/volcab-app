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

/**
 * Returns a global regex matching every occurrence in the sentence; returns null if it
 * can't be located.
 *
 * Two stages:
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

  const bases = [h]
  if (/[ey]$/.test(h)) bases.push(h.slice(0, -1))
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(h)) bases.push(h + h.slice(-1))

  return bases.some(base => new RegExp(`^${escapeRe(base)}${SUFFIX}$`, 'i').test(s))
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
