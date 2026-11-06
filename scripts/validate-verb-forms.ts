import { readFileSync } from 'node:fs'
import { isInflectionOf, splitByHeadword } from '../src/lib/headword.ts'
import { endsCvc, isSingleWord, piecesText, requiredFields, verbForms } from '../src/lib/verbForms.ts'
import type { Field, VerbForms, VerbFormsFile } from '../src/lib/verbForms.ts'

/**
 * Gate for src/data/verbForms.json, the authored half of the entry page's
 * 动词变形 (docs/superpowers/specs/2026-11-06-verb-forms-design.md).
 *
 * Unlike the word notes, **coverage is enforced**: a verb that needs
 * judgment and has none renders no forms at all, and the judgment is cheap
 * to supply and has exactly one right answer. So every single-word verb in
 * the library must come out of verbForms() with forms, and the error names
 * the field that is missing. Phrases and hyphenated compounds never show
 * forms, by the user's call, so they are skipped here and refused an entry.
 *
 * The last check is the one that earns the file its keep: every -ed / -ing
 * occurrence of a verb in its own examples must be a form the rules and the
 * entry produce. A wrong `double` is invisible on the page and obvious
 * against the examples — it is how four of the IPA's five wrong stress calls
 * would have been caught. The -ing form is not shown, but it is checked:
 * `concurring` in an example confirms `double: true` as surely as
 * `concurred`.
 */

const file = process.argv[2] ?? 'src/data/verbForms.json'
const data = JSON.parse(readFileSync(file, 'utf8')) as VerbFormsFile
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string
  headword: string
  meanings: { pos: string }[]
  examples: string[]
}[]
const byId = new Map(words.map(w => [w.id, w]))
const isVerb = (w: { meanings: { pos: string }[] }) => w.meanings.some(m => /^v\./.test(m.pos.trim()))
const errors: string[] = []

const HINT: Record<Field, string> = {
  past: 'an irregular verb or a spelling the rules cannot make: give `past`',
  pastParticiple: 'give `pastParticiple`',
  presentParticiple: 'give `presentParticiple` (a c or an s/z ending)',
  double:
    'ends consonant–vowel–consonant in more than one syllable: `double: true` if the last syllable is stressed (concurred), `false` if not (pondered), plus `looksDoubled: true` when a learner would double it anyway (fidgeted)',
}
const FORM_KEYS = ['past', 'pastParticiple', 'presentParticiple']
const KNOWN_KEYS = new Set([...FORM_KEYS, 'double', 'looksDoubled'])

if (data.version !== 1) errors.push('version must be 1')
if (typeof data.verbs !== 'object' || data.verbs === null || Array.isArray(data.verbs)) {
  console.error('verbs must be an object')
  process.exit(1)
}

// --- Each entry, on its own ---------------------------------------------------------
const empty: VerbFormsFile = { version: 1, verbs: {} }
const same = (a: VerbForms | null, b: VerbForms | null) => JSON.stringify(a) === JSON.stringify(b)

for (const [id, raw] of Object.entries(data.verbs as Record<string, unknown>)) {
  const w = byId.get(id)
  if (w === undefined) {
    errors.push(`${id}: not in the vocabulary — this entry can never render`)
    continue
  }
  if (!isVerb(w)) {
    errors.push(`${id}: has no verb sense — this entry can never render`)
    continue
  }
  if (!isSingleWord(w.headword)) {
    errors.push(`${id}: a phrase or compound shows no forms — this entry can never render`)
    continue
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`${id}: entry must be an object`)
    continue
  }
  const e = raw as Record<string, unknown>
  for (const k of Object.keys(e)) if (!KNOWN_KEYS.has(k)) errors.push(`${id}: unknown field \`${k}\``)
  for (const k of FORM_KEYS) {
    if (k in e && (typeof e[k] !== 'string' || !/^[a-z]+$/.test(e[k] as string))) {
      errors.push(`${id}: \`${k}\` must be one lowercase word`)
    }
  }
  for (const k of ['double', 'looksDoubled']) {
    if (k in e && typeof e[k] !== 'boolean') errors.push(`${id}: \`${k}\` must be a boolean`)
  }
  if ('looksDoubled' in e && e.double !== false) errors.push(`${id}: \`looksDoubled\` only means something beside \`double: false\``)
  const h = w.headword.trim().toLowerCase()
  if ('double' in e && !endsCvc(h)) errors.push(`${id}: \`double\` only applies to a word ending consonant–vowel–consonant`)
  if (requiredFields(h).length === 0 && same(verbForms(w, empty), verbForms(w, data))) {
    errors.push(`${id}: the rules already spell every form; this entry changes nothing — remove it`)
  }
}

// --- Every single-word verb in the library ----------------------------------------------
const counts: Record<string, number> = { regular: 0, irregular: 0, double: 0, single: 0 }
let shown = 0
let skipped = 0
let shared = 0
let checkedWords = 0
let checkedOccurrences = 0

for (const w of words) {
  if (!isVerb(w)) continue
  if (!isSingleWord(w.headword)) {
    skipped++
    continue
  }
  const h = w.headword.trim().toLowerCase()
  const forms = verbForms(w, data)
  if (forms === null) {
    const raw: unknown = data.verbs[w.id]
    const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const missing = requiredFields(h).filter(f => (f === 'double' ? typeof entry.double !== 'boolean' : typeof entry[f] !== 'string'))
    const why = missing.length > 0 ? missing.map(f => HINT[f]).join('; ') : 'an entry field is malformed'
    errors.push(`${w.id}: shows no forms — ${why}`)
    continue
  }
  shown++
  counts[forms.kind]++
  if (piecesText(forms.past) === piecesText(forms.pastParticiple)) shared++

  const produced = new Set([piecesText(forms.past), piecesText(forms.pastParticiple), forms.presentParticiple])
  let seen = false
  for (const ex of w.examples) {
    for (const seg of splitByHeadword(ex, w.headword)) {
      if (!seg.hit) continue
      const token = seg.text.toLowerCase()
      if (token === h || !/(ed|ing)$/.test(token)) continue
      // A loose headword hit that is not an inflection at all (indict → industrialized) is not this check's business.
      if (!isInflectionOf(token, h)) continue
      seen = true
      checkedOccurrences++
      if (!produced.has(token)) {
        errors.push(`${w.id}: an example writes "${token}", but the forms are ${[...produced].join(' / ')}`)
      }
    }
  }
  if (seen) checkedWords++
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`OK: ${Object.keys(data.verbs).length} entries valid; all ${shown} single-word verbs show forms (${skipped} phrases and compounds show none)`)
console.log(`kinds: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}; past and participle share one row on ${shared}`)
console.log(`examples: ${checkedOccurrences} -ed/-ing occurrences across ${checkedWords} verbs match the forms`)
