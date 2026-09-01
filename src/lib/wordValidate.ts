import type { Word } from '../types'
import { validateEtymology } from './etymology'
import { heteronymRisk } from './heteronym'
import { isShareOrdered, validateShares } from './senseShare'

/**
 * What a valid `Word` is. **One description, three consumers**: the `/add`
 * form, the entry edit form, and `scripts/validate-words.ts`.
 *
 * There used to be three. `WordEditForm.tsx:166` recorded the drift in the
 * comment that paid for this module — "the edit page was written by a
 * different agent, which missed these two checks at the time" — and the
 * script was a third, larger description that neither form had ever caught up
 * with. The forms have no tests, because component code gets none here, so
 * the only copy anything asserted against was the script's.
 *
 * This function returns **codes, not prose**. The forms map them to Chinese
 * (`src/pages/wordIssueText.ts`), the script to English (its own `ISSUE_TEXT`);
 * both maps are `Record<WordIssueCode, string>`, so adding a rule without a
 * message is a compile error. A single function cannot return both languages:
 * form output is UI and must be Chinese, script output is developer tooling
 * and is English.
 *
 * ## What each of the three enforced before, and what won
 *
 * `A` = AddWord.validate, `E` = WordEditForm.handleSubmit, `S` = validate-words.ts.
 * "form-safe" marks a rule the forms already satisfied by construction rather
 * than by checking — those now fail loudly instead of relying on the argument
 * still being true.
 *
 * | rule | A | E | S | reading chosen |
 * |---|---|---|---|---|
 * | `id.empty` / `id.format` | form-safe | form-safe | yes | keep S |
 * | `headword.empty` | yes | — | yes | keep; E never edited the headword |
 * | `phonetic.notSlashed` | yes | **no** | yes | **enforce in E too** — the drift at WordEditForm.tsx:166 |
 * | `meanings.empty` | yes | yes | yes | agreed |
 * | `meanings.incomplete` | yes | yes | yes | agreed; blank-after-trim counts as missing (A and E trimmed, S tested truthiness, so `pos: "  "` passed only S) |
 * | `meanings.phoneticNotSlashed` | — | — | yes | keep S; neither form has the input |
 * | `meanings.speakAs*` (3 rules) | — | — | yes | keep S |
 * | `heteronym.phoneticRequired` | — | — | yes | keep S; both forms now block rather than save an entry the gate will reject |
 * | `heteronym.speakAsRequired` | — | — | yes | keep S |
 * | `share.invalid` | yes | yes | yes | agreed (`senseShare.validateShares`) |
 * | `share.unordered` | form-safe | form-safe | yes | keep S; both forms `normalizeMeanings` first, so it cannot fire there |
 * | `examples.tooFew` | yes | yes | yes | agreed; blanks do not count toward the 2 (A and E filtered them, S counted array length, so `["", ""]` passed only S) |
 * | `wordList.notArray` | form-safe | form-safe | yes | keep S |
 * | `wordList.includesHeadword` | yes | yes | yes | **case-insensitive**: both forms excluded case-insensitively, S compared exactly. Measured over 717 entries: zero self-references at all, so the strict reading costs nothing today |
 * | `relatedForms.notArray` | form-safe | form-safe | yes | keep S |
 * | `relatedForms.partial` | yes | **no** | yes | **enforce in E too**; E never edited relatedForms |
 * | `sourceNote.empty` | form-safe | form-safe | yes | keep S |
 * | `addedAt.format` | form-safe | form-safe | yes | keep S |
 * | `usageScore.missing` | yes | yes | yes | agreed |
 * | `usageScore.range` | form-safe | form-safe | yes | keep S; both forms render a 1–10 `<select>` |
 * | `etymology.empty` | form-safe | form-safe | yes | keep S; `normalizeEtymology` drops a blank before either form gets here |
 * | `etymology.tooLong` | yes | yes | yes | agreed (`etymology.validateEtymology`) |
 *
 * ## What deliberately stays out
 *
 * Rules about the **file** rather than a word: duplicate ids and the `version`
 * field, both still in `validate-words.ts`. Rules about **form state** rather
 * than a word: whether a `<select>` has been touched yet, how one text field
 * is split into a tag list, and whether the headword collides with an entry
 * the library already has.
 *
 * ## Two rules whose message belongs to another module
 *
 * `senseShare.validateShares` and `etymology.validateEtymology` already return
 * a ready Chinese sentence, and they are shared with the script. Rather than
 * restate their prose here or in a message map — the duplication this module
 * exists to remove — `share.invalid` and `etymology.tooLong` carry that
 * sentence in `detail`, and the Chinese map is just `{detail}`. The forms
 * therefore show exactly the string they showed before. The English map writes
 * its own sentence for `etymology.tooLong` and ignores the detail; for
 * `share.invalid` it prints the detail, which is what the script already did.
 */

/** The part of the entry an issue belongs to. The forms use it to pick which error slot to render in. */
export type WordField =
  | 'id'
  | 'headword'
  | 'phonetic'
  | 'meanings'
  | 'share'
  | 'examples'
  | 'synonyms'
  | 'antonyms'
  | 'collocations'
  | 'relatedForms'
  | 'sourceNote'
  | 'addedAt'
  | 'usageScore'
  | 'etymology'

export type WordIssueCode =
  | 'id.empty'
  | 'id.format'
  | 'headword.empty'
  | 'phonetic.notSlashed'
  | 'meanings.empty'
  | 'meanings.incomplete'
  | 'meanings.phoneticNotSlashed'
  | 'meanings.speakAsInvalid'
  | 'meanings.speakAsIsIpa'
  | 'meanings.speakAsWithoutPhonetic'
  | 'heteronym.phoneticRequired'
  | 'heteronym.speakAsRequired'
  | 'share.invalid'
  | 'share.unordered'
  | 'examples.tooFew'
  | 'wordList.notArray'
  | 'wordList.includesHeadword'
  | 'relatedForms.notArray'
  | 'relatedForms.partial'
  | 'sourceNote.empty'
  | 'addedAt.format'
  | 'usageScore.missing'
  | 'usageScore.range'
  | 'etymology.empty'
  | 'etymology.tooLong'

export interface WordIssue {
  field: WordField
  code: WordIssueCode
  /**
   * The one variable part of the message — a 1-based row number, an offending
   * value, a count. Substituted for `{detail}` by `formatWordIssue`; a message
   * that does not mention `{detail}` simply drops it.
   */
  detail?: string
}

/** A `Word` or a form draft; every field optional so the forms can call it before the user is done. */
export type WordDraft = Partial<Word>

/** The number of example sentences an entry must carry to be accepted. */
export const MIN_EXAMPLES = 2

const SLASHED = /^\/.+\/$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isSlashed = (v: unknown): boolean => typeof v === 'string' && SLASHED.test(v)
/**
 * Present, a string, and not blank. **Trimmed**, unlike the script's old
 * truthiness tests: both forms trimmed before checking, so `pos: "  "` was
 * rejected by the app and accepted by the gate.
 */
const isFilled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== ''
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Substitute the issue's `detail` into one of the two message maps. */
export function formatWordIssue(issue: WordIssue, texts: Record<WordIssueCode, string>): string {
  return texts[issue.code].replace('{detail}', issue.detail ?? '')
}

/**
 * Every rule that is about a single word. Returns an empty array for a valid
 * entry.
 *
 * **Lenient about types, strict about content.** The script hands this raw
 * parsed JSON, which `WordDraft` cannot honestly describe, so every field is
 * probed at runtime rather than trusted; a wrong-typed field produces the same
 * issue a missing one would, never a throw.
 */
export function validateWordDraft(draft: WordDraft): WordIssue[] {
  const issues: WordIssue[] = []
  const add = (field: WordField, code: WordIssueCode, detail?: string): void => {
    issues.push(detail === undefined ? { field, code } : { field, code, detail })
  }

  if (!isFilled(draft.id)) add('id', 'id.empty')
  else if (draft.id !== draft.id!.toLowerCase() || /\s/.test(draft.id!)) {
    // Once written as `id !== id.toLowerCase().trim()`, which let an id with a
    // space in the middle (`refute refuted`) through while the message claimed
    // "no whitespace". parseSentence in lib/passage.ts rejects markers on
    // exactly the lowercase/no-whitespace rule, so a looser gate here admits
    // ids that can never match a word.
    add('id', 'id.format', JSON.stringify(draft.id))
  }

  const headword = isFilled(draft.headword) ? draft.headword!.trim() : ''
  if (headword === '') add('headword', 'headword.empty')

  if (!isSlashed(draft.phonetic)) add('phonetic', 'phonetic.notSlashed')

  const meanings = Array.isArray(draft.meanings) ? draft.meanings : []
  if (meanings.length === 0) add('meanings', 'meanings.empty')
  meanings.forEach((m, i) => {
    const row = String(i + 1)
    if (!isRecord(m) || !isFilled(m.pos) || !isFilled(m.en) || !isFilled(m.zh)) {
      add('meanings', 'meanings.incomplete', row)
      return
    }
    if (m.phonetic !== undefined && !isSlashed(m.phonetic)) {
      add('meanings', 'meanings.phoneticNotSlashed', JSON.stringify(m.phonetic))
    }
    // speakAs is fed to a speech synthesizer, never displayed. The likely
    // mistake is pasting the IPA in, which the synthesizer reads aloud as
    // punctuation — hence the inverse of the rule above.
    if (m.speakAs !== undefined) {
      if (!isFilled(m.speakAs)) add('meanings', 'meanings.speakAsInvalid', JSON.stringify(m.speakAs))
      else if (String(m.speakAs).includes('/')) add('meanings', 'meanings.speakAsIsIpa', JSON.stringify(m.speakAs))
      if (m.phonetic === undefined) add('meanings', 'meanings.speakAsWithoutPhonetic')
    }
  })

  // A heteronym cannot be described by one pronunciation, and the omission is
  // invisible on inspection. See lib/heteronym.ts for why this is a curated
  // list plus one systematic rule and not a guess from part of speech.
  const senses = meanings.filter(isRecord)
  if (senses.length > 0) {
    // "Carries a phonetic" is not the test — "carries one that says something
    // new" is. This once accepted any sense-level phonetic, and presage
    // satisfied it with a verb sense holding a byte-identical copy of the
    // word-level string: the gate passed while the entry recorded zero second
    // pronunciations.
    const divergent = senses.filter(m => m.phonetic !== undefined && m.phonetic !== draft.phonetic)
    const reason = heteronymRisk(headword, senses.map(m => String(m.pos ?? '')))
    if (reason !== null && divergent.length === 0) add('meanings', 'heteronym.phoneticRequired', reason)
    // A divergent sense has no recording to play — see Meaning.speakAs — so
    // without a respelling it has no sound at all, and senseVoices drops the
    // per-sense buttons from the *whole* entry rather than show one sense with
    // audio and one without. Keyed off the divergence itself rather than
    // heteronymRisk, so a word that is not on the curated list is still held
    // to it.
    for (const m of divergent) {
      if (!isFilled(m.speakAs)) {
        add('meanings', 'heteronym.speakAsRequired', `${String(m.pos ?? '')} ${String(m.phonetic ?? '')}`.trim())
      }
    }

    const shareErr = validateShares(senses as { share?: number }[])
    if (shareErr !== null) add('share', 'share.invalid', shareErr)
    else if (!isShareOrdered(senses as { share?: number }[])) add('share', 'share.unordered')
  }

  const examples = Array.isArray(draft.examples) ? draft.examples.filter(isFilled) : []
  if (examples.length < MIN_EXAMPLES) add('examples', 'examples.tooFew', String(examples.length))

  for (const key of ['synonyms', 'antonyms', 'collocations'] as const) {
    const list = draft[key]
    if (!Array.isArray(list)) {
      add(key, 'wordList.notArray', key)
    } else if (headword !== '' && list.some(v => String(v).trim().toLowerCase() === headword.toLowerCase())) {
      add(key, 'wordList.includesHeadword', key)
    }
  }

  if (!Array.isArray(draft.relatedForms)) add('relatedForms', 'relatedForms.notArray')
  else {
    draft.relatedForms.forEach((r, i) => {
      if (!isRecord(r) || !isFilled(r.form) || !isFilled(r.pos) || !isFilled(r.zh)) {
        add('relatedForms', 'relatedForms.partial', String(i + 1))
      }
    })
  }

  if (!isFilled(draft.sourceNote)) add('sourceNote', 'sourceNote.empty')
  if (typeof draft.addedAt !== 'string' || !ISO_DATE.test(draft.addedAt)) add('addedAt', 'addedAt.format')

  // usageScore is **required on the write side** and optional in src/types.ts
  // and sync.ts: strict on write, lenient on read. Every path that produces an
  // entry can produce a score — both forms make it a required <select>, and
  // the batch-completion flow writes it (docs/word-entry-spec.md) — so letting
  // it through would just mean the row silently never shows during review.
  if (draft.usageScore === undefined) add('usageScore', 'usageScore.missing')
  else if (!Number.isInteger(draft.usageScore) || draft.usageScore < 1 || draft.usageScore > 10) {
    add('usageScore', 'usageScore.range', JSON.stringify(draft.usageScore))
  }

  // etymology is the opposite of the fields above: absence is valid, only the
  // shape when present is checked. Not every word has a decomposable
  // etymology, and inventing one is worse than leaving it out — but an empty
  // or whitespace-only value is dirty data, since the display layer would read
  // it as "has etymology" and render a heading with nothing under it.
  if (draft.etymology !== undefined) {
    if (!isFilled(draft.etymology)) add('etymology', 'etymology.empty')
    else {
      const err = validateEtymology(draft.etymology)
      if (err !== null) add('etymology', 'etymology.tooLong', err)
    }
  }

  return issues
}
