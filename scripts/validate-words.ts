import { readFileSync } from 'node:fs'
import { ETYMOLOGY_MAX } from '../src/lib/etymology.ts'
import { isShareOrdered, validateShares } from '../src/lib/senseShare.ts'

const file = process.argv[2] ?? 'data/words.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors: string[] = []

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.words)) { console.error('words must be an array'); process.exit(1) }

const seen = new Set<string>()
for (const w of data.words) {
  const ctx = w.id ?? '(missing id)'
  if (!w.id || w.id !== String(w.id).toLowerCase().trim()) errors.push(`${ctx}: id must be lowercase with no whitespace`)
  if (seen.has(w.id)) errors.push(`${ctx}: duplicate id`)
  seen.add(w.id)
  if (!w.headword) errors.push(`${ctx}: missing headword`)
  if (!/^\/.+\/$/.test(w.phonetic ?? '')) errors.push(`${ctx}: phonetic must look like /.../`)
  if (!Array.isArray(w.meanings) || w.meanings.length === 0) errors.push(`${ctx}: meanings is empty`)
  for (const m of w.meanings ?? []) {
    if (!m.pos || !m.en || !m.zh) errors.push(`${ctx}: meaning missing pos/en/zh`)
  }
  // Sense share: the rule shares one implementation (src/lib/senseShare.ts)
  // with both entry forms, so the script and the App don't each write their
  // own copy that quietly drifts apart later.
  if (Array.isArray(w.meanings)) {
    const shareErr = validateShares(w.meanings)
    if (shareErr) errors.push(`${ctx}: ${shareErr}`)
    else if (!isShareOrdered(w.meanings)) errors.push(`${ctx}: senses must be ordered from highest to lowest share`)
  }
  if (!Array.isArray(w.examples) || w.examples.length < 2) errors.push(`${ctx}: examples needs at least 2 sentences`)
  for (const k of ['synonyms', 'antonyms', 'collocations'] as const) {
    if (!Array.isArray(w[k])) errors.push(`${ctx}: ${k} must be an array`)
    else if (w[k].includes(w.headword)) errors.push(`${ctx}: ${k} should not include the entry itself`)
  }
  if (!Array.isArray(w.relatedForms)) errors.push(`${ctx}: relatedForms must be an array`)
  for (const r of w.relatedForms ?? []) {
    if (!r.form || !r.pos || !r.zh) errors.push(`${ctx}: relatedForm missing form/pos/zh`)
  }
  if (!w.sourceNote) errors.push(`${ctx}: missing sourceNote`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.addedAt ?? '')) errors.push(`${ctx}: addedAt must be YYYY-MM-DD`)
  // usageScore is now **required**: both entry forms require it, and the
  // entry-completion flow produces it too (see docs/word-entry-spec.md). It
  // used to be optional because words added manually inside the App
  // couldn't get a score; that path has since been closed off, so letting
  // it through now would just mean new words could quietly end up missing
  // a score, and that row wouldn't show during review.
  // Note that src/types.ts and sync.ts still treat it as optional -- strict
  // on the write side, lenient on the read side.
  if (w.usageScore === undefined) {
    errors.push(`${ctx}: missing usageScore (an integer from 1-10)`)
  } else if (!Number.isInteger(w.usageScore) || w.usageScore < 1 || w.usageScore > 10) {
    errors.push(`${ctx}: usageScore must be an integer from 1-10, got ${JSON.stringify(w.usageScore)}`)
  }
  // etymology is the opposite of the fields above: **doesn't validate
  // whether it exists, only the shape when it does**. Not every word has an
  // etymology (see the field comment in src/types.ts), so absence is a
  // valid state; but an empty or whitespace-only etymology is dirty data --
  // it would make the display layer think "this word has an etymology" and
  // then render an empty section heading.
  if (w.etymology !== undefined) {
    if (typeof w.etymology !== 'string' || w.etymology.trim() === '') {
      errors.push(`${ctx}: etymology, when present, must be a non-empty string (omit the field entirely if there's no etymology)`)
    } else if (w.etymology.length > ETYMOLOGY_MAX) {
      errors.push(`${ctx}: etymology exceeds ${ETYMOLOGY_MAX} characters (got ${w.etymology.length}); it's a sentence, not a paragraph of research`)
    }
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`OK: ${data.words.length} entries passed validation`)
