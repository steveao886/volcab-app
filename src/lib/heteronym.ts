/**
 * Words whose pronunciation depends on which sense you mean.
 *
 * A `Word` carries one `phonetic`. For almost every entry that is the truth;
 * for a heteronym it is a silent half-truth, and the half that gets dropped
 * is invisible on inspection — `record` with `/rɪˈkɔːrd/` looks like a
 * finished entry whether or not it also means the noun.
 *
 * This exists to make that non-silent on the write side. It deliberately
 * does **not** try to detect heteronyms structurally from part of speech
 * alone: 19 entries in the library span n./v. or adj./v. and all but one of
 * them — harangue, mire, grouse, rebuke, mime — keep a single pronunciation
 * throughout. Flagging those would produce a gate that is wrong nineteen
 * times out of twenty, which is a gate that gets ignored.
 *
 * So: one systematic rule that is reliable, plus a hand-kept list.
 */

/**
 * The `-ate` alternation, which is regular enough to detect by rule.
 *
 * An `-ate` word that is both a verb and something else takes /-eɪt/ as the
 * verb and the reduced /-ət/ otherwise: separate, deliberate, moderate,
 * graduate, estimate, advocate, duplicate, associate. The library's
 * `indurate` is exactly this shape.
 */
function hasAteAlternation(headword: string, pos: readonly string[]): boolean {
  if (!/ate$/i.test(headword.trim())) return false
  const set = new Set(pos)
  return set.has('v.') && (set.has('adj.') || set.has('n.'))
}

/**
 * Hand-kept, and deliberately short: only words where the two
 * pronunciations are genuinely distinct and both senses are live in
 * contemporary English. Adding a word here is a claim that a single
 * `phonetic` cannot describe it.
 *
 * Mostly the noun/verb stress shift (`ˈREcord` against `reCORD`), plus the
 * handful of true heteronyms where the vowel changes outright.
 */
const KNOWN = new Set([
  // noun or adjective initial-stress against verb final-stress
  'record', 'present', 'contract', 'conduct', 'conflict', 'contest', 'convert',
  'convict', 'decrease', 'increase', 'insult', 'object', 'permit', 'produce',
  'progress', 'project', 'protest', 'rebel', 'subject', 'suspect', 'survey',
  'transfer', 'transport', 'upset', 'compound', 'discount', 'escort', 'exploit',
  'extract', 'ferment', 'import', 'export', 'imprint', 'perfect', 'pervert',
  'recount', 'segment', 'torment', 'attribute', 'digest', 'entrance', 'incense',
  'console', 'content', 'refuse', 'indent', 'presage', 'invalid',
  // the vowel itself changes
  'lead', 'live', 'close', 'use', 'abuse', 'excuse', 'house', 'wound', 'bow',
  'tear', 'minute', 'desert', 'sow', 'row', 'wind', 'resume', 'buffet',
  'learned', 'dogged', 'ragged', 'wicked', 'august',
])

/*
 * Two words were on this list and came off after checking them against the
 * entries that triggered them, which is the use the list is for:
 *
 * `relapse` — the noun looks like it should have shifted to initial stress
 * the way `record` did, but it never did: dictionaries give /rɪˈlæps/ as the
 * noun's primary pronunciation too, with /ˈriːlæps/ only a variant. One
 * phonetic describes it honestly.
 *
 * `polish` — the pair is polish/Polish, which differ in capitalisation and
 * are therefore different headwords. Listing it could only ever fire on the
 * shine senses, which do not differ.
 */

export type HeteronymReason = 'ate-alternation' | 'known'

/**
 * Whether this entry needs more than one pronunciation, and why.
 *
 * Returns null for a monosemous entry whatever the spelling: `object`
 * entered only as a verb has one pronunciation and one truth to tell. The
 * risk only exists once two senses share the headword.
 */
export function heteronymRisk(headword: string, pos: readonly string[]): HeteronymReason | null {
  if (pos.length < 2) return null
  if (hasAteAlternation(headword, pos)) return 'ate-alternation'
  return KNOWN.has(headword.trim().toLowerCase()) ? 'known' : null
}
