import { readFileSync } from 'node:fs'
import { ETYMOLOGY_MAX } from '../src/lib/etymology.ts'
import { formatWordIssue, validateWordDraft } from '../src/lib/wordValidate.ts'
import type { WordIssueCode } from '../src/lib/wordValidate.ts'

/**
 * The English line for each rule in src/lib/wordValidate.ts, which is the one
 * description of a valid Word — shared with the /add form and the entry edit
 * form, which map the same codes to Chinese (src/pages/wordIssueText.ts).
 *
 * `Record<WordIssueCode, string>` is the exhaustiveness check: a rule added
 * without a line here fails the type check. Do not widen it to `Partial`.
 *
 * `share.invalid` prints `{detail}`, which is the Chinese sentence
 * senseShare.ts returns — that is what this script already printed for share
 * errors, and it is the sentence the form shows, so there is exactly one copy
 * of it. `etymology.tooLong` goes the other way and writes its own English
 * line, dropping the character count the Chinese version carries.
 */
const ISSUE_TEXT: Record<WordIssueCode, string> = {
  'id.empty': 'missing id',
  'id.format': 'id must be lowercase with no whitespace, got {detail}',
  'headword.empty': 'missing headword',
  'phonetic.notSlashed': 'phonetic must look like /.../',
  'meanings.empty': 'meanings is empty',
  'meanings.incomplete': 'meaning {detail} missing pos/en/zh',
  'meanings.phoneticNotSlashed': 'meaning phonetic must look like /.../, got {detail}',
  'meanings.speakAsInvalid': 'meaning speakAs must be a non-empty string, got {detail}',
  'meanings.speakAsIsIpa': 'meaning speakAs is a respelling for a speech synthesizer, not IPA — got {detail}',
  'meanings.speakAsWithoutPhonetic': 'meaning has speakAs but no phonetic — a respelling means nothing without the pronunciation it spells',
  'heteronym.phoneticRequired': 'this headword is pronounced differently depending on the sense ({detail}), but every meaning shares the single word-level phonetic. '
    + 'Give the sense that differs its own `phonetic`. If the two senses really do sound alike, take the word off KNOWN in src/lib/heteronym.ts and say why.',
  'heteronym.speakAsRequired': 'the {detail} sense has its own phonetic, which no recording can play. '
    + 'Add a `speakAs` respelling for the synthesizer — e.g. presage /ˈprɛsɪdʒ/ is written "press-idge" — and listen to it before committing.',
  'share.invalid': '{detail}',
  'share.unordered': 'senses must be ordered from highest to lowest share',
  'examples.tooFew': 'examples needs at least 2 sentences, got {detail}',
  'wordList.notArray': '{detail} must be an array',
  'wordList.includesHeadword': '{detail} should not include the entry itself',
  'relatedForms.notArray': 'relatedForms must be an array',
  'relatedForms.partial': 'relatedForm {detail} missing form/pos/zh',
  'sourceNote.empty': 'missing sourceNote',
  'addedAt.format': 'addedAt must be YYYY-MM-DD',
  'usageScore.missing': 'missing usageScore (an integer from 1-10)',
  'usageScore.range': 'usageScore must be an integer from 1-10, got {detail}',
  'etymology.empty': "etymology, when present, must be a non-empty string (omit the field entirely if there's no etymology)",
  'etymology.tooLong': `etymology exceeds ${ETYMOLOGY_MAX} characters; it's a sentence, not a paragraph of research`,
}

const file = process.argv[2] ?? 'data/words.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors: string[] = []

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.words)) { console.error('words must be an array'); process.exit(1) }

const seen = new Set<string>()
for (const w of data.words) {
  const ctx = w.id ?? '(missing id)'
  // Duplicate ids are a property of the *file*, not of a word, so this one
  // check stays here while every per-word rule lives in validateWordDraft.
  if (seen.has(w.id)) errors.push(`${ctx}: duplicate id`)
  seen.add(w.id)
  for (const issue of validateWordDraft(w)) errors.push(`${ctx}: ${formatWordIssue(issue, ISSUE_TEXT)}`)
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`OK: ${data.words.length} entries passed validation`)
