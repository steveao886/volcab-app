import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Select } from '../components/Select'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'
import { normalizeEtymology } from '../lib/etymology'
import {
  SHARE_OPTIONS,
  USAGE_SCORE_OPTIONS,
  normalizeMeanings,
  shareSum,
} from '../lib/senseShare'
import { validateWordDraft } from '../lib/wordValidate'
import type { Meaning, Word } from '../types'
import { wordIssueMessage } from './wordIssueText'

/**
 * Word entry edit form.
 *
 * What's exposed here as editable: meanings (including meaning share) /
 * examples / synonyms / antonyms / collocations / usageScore — id /
 * headword / phonetic / relatedForms / sourceNote / addedAt are always
 * carried over unchanged, merged on submit as
 * `{ ...word, ...editedFields }`, so fields not shown in this form are
 * never silently swallowed. `meanings` is the exception that has to earn
 * that claim separately — it is rebuilt rather than merged, so see the note
 * on the rebuild in handleSubmit.
 *
 * usageScore and meaning share must be editable here, not just fillable on
 * /add: otherwise a mistake here has no way to be corrected, and share
 * would get silently wiped out by the meanings-rebuild step below anyway —
 * a user fixing a typo shouldn't lose the share value as a side effect.
 *
 * synonyms/antonyms/collocations are flat string arrays, edited with a
 * single "one per line" Textarea rather than a group of per-item
 * add/remove controls — meanings is the one that earns that complexity
 * (it's a structured pos/en/zh triple); there's no need to copy that
 * pattern for three flat lists.
 *
 * The two <legend>s use .worddetail-section-title (the same class as the
 * "Examples"/"Synonyms" section headings in this page's read-only state),
 * not .pos — .pos is a part-of-speech tag, and structural section headers
 * shouldn't use vermilion.
 */

let keySeed = 0
const nextKey = () => `k${keySeed++}`

interface MeaningRow extends Meaning {
  key: string
}

interface ExampleRow {
  key: string
  value: string
}

/**
 * One item per line, and also drops any entry that matches the headword —
 * scripts/validate-words.ts explicitly requires that synonyms/antonyms/
 * collocations must not contain the entry itself.
 */
function linesToArray(text: string, headword: string): string[] {
  const self = headword.trim().toLowerCase()
  return text
    .split('\n')
    .map(s => s.trim())
    .filter(s => s !== '' && s.toLowerCase() !== self)
}

interface WordEditFormProps {
  word: Word
  saving: boolean
  onCancel: () => void
  onSave: (updated: Word) => void | Promise<void>
}

export function WordEditForm({ word, saving, onCancel, onSave }: WordEditFormProps) {
  const [meanings, setMeanings] = useState<MeaningRow[]>(() => word.meanings.map(m => ({ ...m, key: nextKey() })))
  const [examples, setExamples] = useState<ExampleRow[]>(() => word.examples.map(e => ({ value: e, key: nextKey() })))
  const [synonymsText, setSynonymsText] = useState(() => word.synonyms.join('\n'))
  const [antonymsText, setAntonymsText] = useState(() => word.antonyms.join('\n'))
  const [collocationsText, setCollocationsText] = useState(() => word.collocations.join('\n'))
  // Older entries may not have a usageScore (back when it was still an
  // optional field); in that case, an empty string means "unscored", and
  // the user must pick one before saving — a single edit fills it in as a
  // side effect.
  const [usageScoreInput, setUsageScoreInput] = useState(() =>
    word.usageScore === undefined ? '' : String(word.usageScore),
  )
  // Unlike usageScore, etymology's empty string is a valid final state,
  // not "still needs filling in". Clearing it removes the field entirely.
  const [etymologyInput, setEtymologyInput] = useState(() => word.etymology ?? '')
  const [error, setError] = useState<string | null>(null)

  // For the live hint; the actual submit-blocking check is validateShares inside handleSubmit.
  const shareTotal = shareSum(meanings)

  function updateMeaning(key: string, patch: Partial<Meaning>) {
    setMeanings(prev => prev.map(m => (m.key === key ? { ...m, ...patch } : m)))
  }
  function removeMeaning(key: string) {
    setMeanings(prev => prev.filter(m => m.key !== key))
  }
  function addMeaning() {
    setMeanings(prev => [...prev, { pos: '', en: '', zh: '', key: nextKey() }])
  }

  function updateExample(key: string, value: string) {
    setExamples(prev => prev.map(e => (e.key === key ? { ...e, value } : e)))
  }
  function removeExample(key: string) {
    setExamples(prev => prev.filter(e => e.key !== key))
  }
  function addExample() {
    setExamples(prev => [...prev, { value: '', key: nextKey() }])
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return

    // normalizeMeanings does two things at once here: strips any leftover
    // share once only one meaning remains (once the user has deleted down
    // to one, it shouldn't carry a share anymore), and re-sorts by share
    // descending — aligning with the storage invariant required by
    // scripts/validate-words.ts, without bothering the user to sort it
    // themselves.
    //
    // Everything but `key` is carried through by the rest spread, and that
    // shape is load-bearing rather than stylistic. This was once an explicit
    // `{ pos, en, zh }` plus share, which silently deleted `phonetic` from
    // both of the library's heteronyms the first time either was edited —
    // the one field on a Meaning that this form has no input for. An
    // allow-list here has to be updated by whoever adds the next optional
    // field, and the cost of forgetting is destroyed data on save, so the
    // default is now "survives".
    const cleanedMeanings: Meaning[] = normalizeMeanings(
      meanings
        .map(({ key: _key, ...m }) => ({ ...m, pos: m.pos.trim(), en: m.en.trim(), zh: m.zh.trim() }))
        .filter(m => m.pos !== '' || m.en !== '' || m.zh !== ''),
    )

    const updated: Word = {
      ...word,
      meanings: cleanedMeanings,
      examples: examples.map(e => e.value.trim()).filter(v => v !== ''),
      // None of synonyms/antonyms/collocations should contain the entry itself
      synonyms: linesToArray(synonymsText, word.headword),
      antonyms: linesToArray(antonymsText, word.headword),
      collocations: linesToArray(collocationsText, word.headword),
    }
    // The empty <select> option means "not scored yet", which is the absence
    // of the field, not the number 0 — and clearing it back to 请选择 has to
    // remove the key rather than leave `usageScore: undefined` behind, for the
    // same reason as etymology below.
    if (usageScoreInput === '') delete updated.usageScore
    else updated.usageScore = Number(usageScoreInput)
    // Clearing the input must actually delete the key, not leave behind an
    // `etymology: undefined`: that in-memory object would carry the key
    // along into the store and then into merge — JSON serialization would
    // eventually drop it, but any `'etymology' in word`-style check before
    // that point would still see it. Better to delete it cleanly.
    const etymology = normalizeEtymology(etymologyInput)
    if (etymology === undefined) delete updated.etymology
    else updated.etymology = etymology

    // One validator, shared with the add form and with the repo gate
    // (src/lib/wordValidate.ts). What this used to be was a hand-written copy
    // that had already drifted: the comment here recorded that "the edit page
    // was written by a different agent, which missed these two checks" — and
    // it was still missing the phonetic and relatedForms rules that AddWord
    // and the script both had. Those now apply here too, on the whole merged
    // entry rather than only the fields this form renders, because that merged
    // entry is what gets saved.
    //
    // Only the first issue is shown: this form has a single error slot, and
    // wordValidate returns issues in entry order, so the first is the one
    // nearest the top of the form.
    const issues = validateWordDraft(updated)
    if (issues.length > 0) {
      setError(wordIssueMessage(issues[0]))
      return
    }

    setError(null)
    void onSave(updated)
  }

  return (
    <form className="worddetail-edit" onSubmit={handleSubmit} noValidate>
      <fieldset className="worddetail-edit__group" disabled={saving}>
        <legend className="section-title worddetail-section-title">释义</legend>
        {meanings.map((m, i) => (
          <div className="worddetail-edit__meaning" key={m.key}>
            <p className="worddetail-edit__index">释义 {i + 1}</p>
            <Field label="词性" htmlFor={`meaning-pos-${m.key}`}>
              <TextInput
                id={`meaning-pos-${m.key}`}
                value={m.pos}
                onChange={e => updateMeaning(m.key, { pos: e.target.value })}
                placeholder="v. / n. / adj. …"
              />
            </Field>
            <Field label="英文释义" htmlFor={`meaning-en-${m.key}`}>
              <Textarea
                id={`meaning-en-${m.key}`}
                rows={2}
                value={m.en}
                onChange={e => updateMeaning(m.key, { en: e.target.value })}
              />
            </Field>
            <Field label="中文释义" htmlFor={`meaning-zh-${m.key}`}>
              <TextInput
                id={`meaning-zh-${m.key}`}
                value={m.zh}
                onChange={e => updateMeaning(m.key, { zh: e.target.value })}
              />
            </Field>
            {/* Share only appears when a word has multiple meanings:
                marking a single-sense word 100% is noise, and it would
                also break the "having a share implies multiple senses"
                check. */}
            {meanings.length > 1 && (
              <Field label="占比" htmlFor={`meaning-share-${m.key}`}>
                <Select
                  id={`meaning-share-${m.key}`}
                  className="num input--compact"
                  value={m.share === undefined ? '' : String(m.share)}
                  onChange={e =>
                    updateMeaning(m.key, {
                      share: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                >
                  <option value="">—</option>
                  {SHARE_OPTIONS.map(s => (
                    <option key={s} value={s}>
                      {s}%
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeMeaning(m.key)}
              disabled={meanings.length <= 1}
            >
              删除这条释义
            </Button>
          </div>
        ))}
        {meanings.length > 1 && (
          <p className={shareTotal === 100 ? 'muted' : 'field__error'} role="status">
            义项占比合计 <span className="num">{shareTotal}%</span>
            {shareTotal === 100 ? '' : ',需为 100%'}
          </p>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={addMeaning}>
          + 添加释义
        </Button>
      </fieldset>

      <fieldset className="worddetail-edit__group" disabled={saving}>
        <legend className="section-title worddetail-section-title">当代遇见概率</legend>
        <Field
          label="1–10"
          htmlFor="edit-usage"
          hint="在真实语境里碰到这个词的可能性。复习卡背面会显示它。"
        >
          <Select
            id="edit-usage"
            className="num input--compact"
            value={usageScoreInput}
            onChange={e => setUsageScoreInput(e.target.value)}
          >
            <option value="">请选择</option>
            {USAGE_SCORE_OPTIONS.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="worddetail-edit__group" disabled={saving}>
        <legend className="section-title worddetail-section-title">例句</legend>
        {examples.map((ex, i) => (
          <div className="worddetail-edit__example" key={ex.key}>
            <Textarea
              rows={2}
              value={ex.value}
              onChange={e => updateExample(ex.key, e.target.value)}
              aria-label={`例句 ${i + 1}`}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => removeExample(ex.key)}>
              删除
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={addExample}>
          + 添加例句
        </Button>
      </fieldset>

      <Field
        label="词源"
        htmlFor="edit-etymology"
        hint="一句话,如「ab-(离开) + rogare(提议) → 废除」。没把握就留空 —— 编一个比不写糟"
      >
        <TextInput
          id="edit-etymology"
          value={etymologyInput}
          onChange={e => setEtymologyInput(e.target.value)}
          disabled={saving}
        />
      </Field>

      <Field label="近义词" htmlFor="edit-synonyms" hint="每行一个,可留空">
        <Textarea id="edit-synonyms" value={synonymsText} onChange={e => setSynonymsText(e.target.value)} disabled={saving} />
      </Field>
      <Field label="反义词" htmlFor="edit-antonyms" hint="每行一个,可留空">
        <Textarea id="edit-antonyms" value={antonymsText} onChange={e => setAntonymsText(e.target.value)} disabled={saving} />
      </Field>
      <Field label="常见搭配" htmlFor="edit-collocations" hint="每行一个,可留空">
        <Textarea
          id="edit-collocations"
          value={collocationsText}
          onChange={e => setCollocationsText(e.target.value)}
          disabled={saving}
        />
      </Field>

      {error !== null && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <div className="worddetail-edit__actions">
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          保存
        </Button>
      </div>
    </form>
  )
}
