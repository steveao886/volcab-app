import { useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { Select } from '../components/Select'
import { SyncStatus } from '../components/SyncStatus'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'
import { normalizeEtymology } from '../lib/etymology'
import {
  SHARE_OPTIONS,
  USAGE_SCORE_OPTIONS,
  normalizeMeanings,
  shareSum,
} from '../lib/senseShare'
import { todayStr } from '../lib/srs'
import { validateWordDraft } from '../lib/wordValidate'
import type { WordField } from '../lib/wordValidate'
import { useApp } from '../state/store'
import type { Meaning, RelatedForm, Word } from '../types'
import { lookupWord } from './dictionaryApi'
import { checkCapture } from '../lib/stagingCapture'
import type { CaptureCheck } from '../lib/stagingCapture'
import { wordIssueMessage } from './wordIssueText'
import './AddWord.css'

/**
 * Repeatable rows in the form: each adds a stable key on top of the
 * corresponding Word type, used solely for React lists. validate() rebuilds
 * a clean object before submit, so the key never ends up stored in Word.
 * Using the array index as the React key causes DOM node reuse to get
 * misaligned when a middle row is removed (cursor position, IME composition
 * state end up drifting onto the wrong row), so each row is issued a
 * monotonically increasing number at creation time; removing or adding
 * rows never affects the numbers of the rest.
 */
interface MeaningRow extends Meaning {
  key: number
}
interface RelatedRow extends RelatedForm {
  key: number
}
interface ExampleRow {
  key: number
  value: string
}

let rowKeySeq = 0
const nextRowKey = (): number => {
  rowKeySeq += 1
  return rowKeySeq
}

const emptyMeaning = (): MeaningRow => ({ key: nextRowKey(), pos: '', en: '', zh: '' })
const emptyRelated = (): RelatedRow => ({ key: nextRowKey(), form: '', pos: '', zh: '' })
const emptyExample = (): ExampleRow => ({ key: nextRowKey(), value: '' })

/** Blocking hint for quick capture. Pulled out only to avoid nesting three ternaries in JSX. */
function captureNotice(check: CaptureCheck): ReactNode {
  if (check.kind === 'in-library') {
    return (
      <>
        「{check.headword}」已在词库中,<Link to={`/word/${check.id}`}>前往查看</Link>
      </>
    )
  }
  if (check.kind === 'in-staging') return `「${check.headword}」已在待补全列表中`
  return undefined
}

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; note?: string }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }

/** Free text separated by commas (half/full-width) / dun commas / newlines → trim whitespace, drop empty entries, dedupe, and exclude the headword itself */
function splitTagList(raw: string, headword: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[,，、\n]/)) {
    const v = piece.trim()
    if (!v || v.toLowerCase() === headword.toLowerCase()) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/**
 * Which error slot a rule's field renders in.
 *
 * Anything without a slot of its own falls through to `general`, which is
 * rendered just above the save button. That default is the point: without it,
 * a rule this form has no input for would block the save with its message
 * nowhere on screen, and the button would just look broken.
 *
 * `id` is the one field deliberately dropped rather than defaulted. It is
 * derived below from a non-empty trimmed headword by lowercasing and
 * collapsing whitespace into hyphens, so it is non-empty, lowercase and
 * whitespace-free by construction; the only way it can go wrong is an empty
 * headword, which has its own slot and its own message. Showing both would put
 * two sentences on screen for one empty box.
 */
function errorSlot(field: WordField): string | null {
  switch (field) {
    case 'id': return null
    case 'share': return 'shares'
    case 'headword':
    case 'phonetic':
    case 'meanings':
    case 'examples':
    case 'relatedForms':
    case 'usageScore':
    case 'etymology':
      return field
    default: return 'general'
  }
}

/**
 * Task 20 implementation: type a word → look up the dictionary API to
 * prefill → editable form → save.
 * v1.1 E: a "quick capture" block was added at the top of the page — the
 * moment you spot a new word on your phone, jot down just the word and move
 * on, leaving the other ten fields for the AI to batch-fill in a chat
 * session later (design doc §6.3). The full form is left unchanged below.
 */
export function AddWord() {
  const { words, staging, addStaging, saveWord, syncStatus, syncError, syncNow } = useApp()

  const [captureInput, setCaptureInput] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [captured, setCaptured] = useState<string | null>(null)

  const [headwordInput, setHeadwordInput] = useState('')
  const [phonetic, setPhonetic] = useState('')
  const [meanings, setMeanings] = useState<MeaningRow[]>([emptyMeaning()])
  const [examples, setExamples] = useState<ExampleRow[]>([emptyExample(), emptyExample()])
  const [synonymsText, setSynonymsText] = useState('')
  const [antonymsText, setAntonymsText] = useState('')
  const [collocationsText, setCollocationsText] = useState('')
  const [relatedForms, setRelatedForms] = useState<RelatedRow[]>([])
  // Empty string = not yet chosen. **No default value**: defaulting to 5
  // would just flood the library with 5s nobody actually decided on, which
  // is worse than a missing score — a missing score is at least an honest
  // "unscored".
  const [usageScoreInput, setUsageScoreInput] = useState('')
  // Unlike usageScore, empty is a valid final state here: etymology is the
  // only field allowed to be absent.
  const [etymologyInput, setEtymologyInput] = useState('')

  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedWord, setSavedWord] = useState<{ id: string; headword: string } | null>(null)

  const headword = headwordInput.trim()
  // Library convention (see plan Task 10 step 2.5): phrase headwords that
  // contain spaces use hyphens in their id, e.g. "ad hoc" → "ad-hoc",
  // consistent with entries like due-diligence in data/words.json.
  // headword itself keeps its spaces for display; only the id is collapsed.
  const id = headword.toLowerCase().replace(/\s+/g, '-')
  const existing = useMemo(() => words.find((w) => w.id === id), [words, id])
  const duplicate = id !== '' && existing !== undefined

  const capture = useMemo(() => checkCapture(captureInput, words, staging), [captureInput, words, staging])

  // The share total here is only a live hint; the actual submit-blocking
  // check is validateShares inside validate().
  const shareTotal = shareSum(meanings)

  async function handleCapture() {
    if (capture.kind !== 'ok' || capturing) return
    const added = capture.headword
    setCapturing(true)
    try {
      // addStaging enqueues locally first, then pushes; whether the push
      // succeeds is reported by the persistent SyncStatus below — if
      // offline, the word is already in the local queue and syncs
      // automatically once back online, so the user never has to redo it.
      await addStaging(added)
      setCaptureInput('')
      setCaptured(added)
    } finally {
      setCapturing(false)
    }
  }

  function handleCaptureKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // This block isn't inside a <form> (there's a full form further down,
    // and nesting forms is invalid), so Enter-to-submit has to be handled
    // manually — on mobile, "one input + Enter" is the fastest capture path.
    if (e.key !== 'Enter') return
    e.preventDefault()
    void handleCapture()
  }

  const resetForm = () => {
    setHeadwordInput('')
    setPhonetic('')
    setMeanings([emptyMeaning()])
    setExamples([emptyExample(), emptyExample()])
    setSynonymsText('')
    setAntonymsText('')
    setCollocationsText('')
    setRelatedForms([])
    setUsageScoreInput('')
    setLookup({ status: 'idle' })
    setFieldErrors({})
    setSavedWord(null)
  }

  async function handleLookup() {
    if (!headword || lookup.status === 'loading') return
    setLookup({ status: 'loading' })
    const result = await lookupWord(headword)
    if (result.status === 'ok') {
      setPhonetic(result.phonetic)
      setMeanings(
        result.meanings.length > 0
          ? result.meanings.map((m) => ({ key: nextRowKey(), ...m, zh: '' }))
          : [emptyMeaning()],
      )
      // Phonetics and meanings are provided independently by the dictionary,
      // not always together (e.g. abrogate: has a meaning but no phonetic) —
      // check them separately and word the message honestly, rather than
      // letting a generic "all filled in" message lie when only half is.
      const hasPhonetic = result.phonetic !== ''
      const hasMeanings = result.meanings.length > 0
      let note: string | undefined
      if (!hasPhonetic && !hasMeanings) note = '词典没有可用的音标或释义,请手动填写。'
      else if (!hasPhonetic) note = '释义已填入,词典未提供音标,请手动填写。'
      else if (!hasMeanings) note = '音标已填入,词典未提供释义,请手动填写。'
      setLookup({ status: 'done', note })
    } else if (result.status === 'not-found') {
      setLookup({ status: 'not-found', message: `词典未收录「${headword}」,请手动填写下方表单。` })
    } else {
      setLookup({ status: 'error', message: `${result.message} 你仍然可以手动填写下方表单。` })
    }
  }

  const updateMeaning = (i: number, patch: Partial<MeaningRow>) =>
    setMeanings((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addMeaning = () => setMeanings((rows) => [...rows, emptyMeaning()])
  const removeMeaning = (i: number) => setMeanings((rows) => (rows.length <= 1 ? rows : rows.filter((_, idx) => idx !== i)))

  const updateExample = (i: number, value: string) =>
    setExamples((rows) => rows.map((r, idx) => (idx === i ? { ...r, value } : r)))
  const addExample = () => setExamples((rows) => [...rows, emptyExample()])
  const removeExample = (i: number) => setExamples((rows) => (rows.length <= 2 ? rows : rows.filter((_, idx) => idx !== i)))

  const updateRelated = (i: number, patch: Partial<RelatedRow>) =>
    setRelatedForms((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRelated = () => setRelatedForms((rows) => [...rows, emptyRelated()])
  const removeRelated = (i: number) => setRelatedForms((rows) => rows.filter((_, idx) => idx !== i))

  /**
   * Assemble, then validate the assembled entry with the same function the
   * repo gate runs (src/lib/wordValidate.ts). The rules are pulled forward
   * into the form rather than left to fail after save — a saved entry must
   * pass validate-words.ts, with no "save now, break later" loophole open.
   *
   * **Three rules stay here**, because they are about this form rather than
   * about a Word:
   *  - the duplicate check, which is a property of the library, not of the
   *    entry (validate-words.ts keeps its own file-level copy);
   *  - how one text field is split into a tag list (splitTagList above);
   *  - "the user has not picked a usageScore yet", which is the empty-string
   *    state of a <select>. The draft simply carries no usageScore, and the
   *    shared rule reports it missing.
   */
  function validate(): Word | null {
    // Normalize before validating: normalization strips the leftover share
    // when only one meaning remains. Otherwise, once the user clears the
    // second meaning (the whole row gets filtered out below), the remaining
    // one still carries a share value and trips the "a single-sense word
    // shouldn't have a meaning-share" error, which doesn't match what they
    // actually did. It also sorts by share descending, which is what keeps
    // the share-ordering rule from ever firing here.
    const meaningRows = normalizeMeanings(
      meanings
        .map((m) => {
          const row: Meaning = { pos: m.pos.trim(), en: m.en.trim(), zh: m.zh.trim() }
          if (m.share !== undefined) row.share = m.share
          return row
        })
        .filter((m) => m.pos || m.en || m.zh),
    )

    const word: Word = {
      id,
      headword,
      phonetic: phonetic.trim(),
      meanings: meaningRows,
      examples: examples.map((e) => e.value.trim()).filter(Boolean),
      synonyms: splitTagList(synonymsText, headword),
      antonyms: splitTagList(antonymsText, headword),
      collocations: splitTagList(collocationsText, headword),
      relatedForms: relatedForms
        .map((r) => ({ form: r.form.trim(), pos: r.pos.trim(), zh: r.zh.trim() }))
        .filter((r) => r.form || r.pos || r.zh),
      sourceNote: 'manual',
      addedAt: todayStr(new Date()),
    }
    if (usageScoreInput !== '') word.usageScore = Number(usageScoreInput)
    // Leave it blank and omit the key entirely, rather than writing an
    // empty string — an empty string would make the display layer treat it
    // as "has etymology" and render a section with a heading but no content.
    const etymology = normalizeEtymology(etymologyInput)
    if (etymology !== undefined) word.etymology = etymology

    const errors: Record<string, string> = {}
    for (const issue of validateWordDraft(word)) {
      const slot = errorSlot(issue.field)
      // First issue per slot wins: each slot renders one sentence, and the
      // first is the one nearest the top of the entry.
      if (slot !== null && errors[slot] === undefined) errors[slot] = wordIssueMessage(issue)
    }
    if (duplicate) errors.headword = '该词条已存在'

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return null
    return word
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    const word = validate()
    if (!word) return
    setSaving(true)
    try {
      await saveWord(word)
      setSavedWord({ id: word.id, headword: word.headword })
    } catch (err) {
      setFieldErrors((prev) => ({
        ...prev,
        general: err instanceof Error ? err.message : '保存失败,请重试',
      }))
    } finally {
      setSaving(false)
    }
  }

  if (savedWord) {
    return (
      <Page eyebrow="New Entry" title="添加新词" back="/library">
        <Card role="status" className="addword-saved">
          <Badge tone="accent">已保存</Badge>
          <p className="addword-saved__headline">
            <span className="word" lang="en">
              {savedWord.headword}
            </span>{' '}
            已存入本机词库。
          </p>
          <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
          <div className="addword-saved__actions">
            <Link className="btn btn--secondary" to={`/word/${savedWord.id}`}>
              查看词条
            </Link>
            <Button variant="primary" onClick={resetForm}>
              继续添加下一个
            </Button>
          </div>
        </Card>
      </Page>
    )
  }

  return (
    <Page eyebrow="New Entry" title="添加新词" back="/library">
      {/* Quick capture sits at the very top, the default thing you see on
          opening this page: capturing must stay as cheap as one input box.
          It **cannot** go inside the <form> below — nesting forms is invalid,
          and Enter would accidentally trigger a full entry save. The full
          form is left unchanged below, for the "I want to fill it all in
          right now" case. */}
      <Card className="addword-capture">
        <div className="addword-section-head">
          <h2 className="addword-section-title">快速收词</h2>
          <p className="addword-section-hint muted">只记单词,音标、释义、例句稍后一次补全</p>
        </div>
        <div className="addword-lookup-row">
          <Field label="单词" htmlFor="aw-capture" error={captureNotice(capture)}>
            <TextInput
              id="aw-capture"
              value={captureInput}
              onChange={(e) => {
                setCaptureInput(e.target.value)
                setCaptured(null)
              }}
              onKeyDown={handleCaptureKeyDown}
              placeholder="ostensible"
              lang="en"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
            />
          </Field>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleCapture()}
            loading={capturing}
            disabled={capture.kind !== 'ok' || capturing}
          >
            加入待补全
          </Button>
        </div>

        <p className="addword-capture__status" role="status">
          待补全 {staging.length} 个
          {captured === null ? '' : ` · 已加入「${captured}」`}
        </p>

        {staging.length > 0 && (
          <div className="addword-capture__list">
            {staging.map((s) => (
              <Chip key={s.headword} label={s.headword} interactive={false} />
            ))}
          </div>
        )}
      </Card>

      <form className="addword-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <Card className="addword-stack">
          <div className="addword-section-head">
            <h2 className="addword-section-title">完整添加</h2>
            <p className="addword-section-hint muted">现在就把整个词条填完,保存后直接进入复习</p>
          </div>
          <div className="addword-lookup-row">
            <Field
              label="单词"
              htmlFor="aw-headword"
              hint="保存时会转成小写作为 id"
              error={
                duplicate ? (
                  <>
                    该词条已存在,<Link to={`/word/${id}`}>前往编辑</Link>
                  </>
                ) : (
                  fieldErrors.headword
                )
              }
            >
              <TextInput
                id="aw-headword"
                value={headwordInput}
                onChange={(e) => setHeadwordInput(e.target.value)}
                placeholder="abrogate"
                lang="en"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleLookup()}
              loading={lookup.status === 'loading'}
              disabled={!headword || lookup.status === 'loading'}
            >
              <Icon name="search" size={18} />
              查询
            </Button>
          </div>
          {lookup.status !== 'idle' && lookup.status !== 'loading' && (
            <p className={`addword-lookup-status addword-lookup-status--${lookup.status}`} role="status">
              {lookup.status === 'done'
                ? (lookup.note ?? '已从词典填入音标与释义,中文释义仍需手动填写。')
                : lookup.message}
            </p>
          )}

          <Field label="音标" htmlFor="aw-phonetic" hint="美式,形如 /ˈæbrəɡeɪt/" error={fieldErrors.phonetic}>
            <TextInput
              id="aw-phonetic"
              className="addword-ipa-input"
              value={phonetic}
              onChange={(e) => setPhonetic(e.target.value)}
              placeholder="/ˈæbrəɡeɪt/"
              lang="en"
            />
          </Field>

          <Field
            label="当代遇见概率"
            htmlFor="aw-usage"
            hint="1–10:在真实语境里碰到这个词的可能性。复习卡背面会显示它。"
            error={fieldErrors.usageScore}
          >
            <Select
              id="aw-usage"
              className="num input--compact"
              value={usageScoreInput}
              onChange={(e) => setUsageScoreInput(e.target.value)}
            >
              <option value="">请选择</option>
              {USAGE_SCORE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="词源"
            htmlFor="aw-etymology"
            hint="可留空。一句话,如「ab-(离开) + rogare(提议) → 废除」。没把握就别写 —— 编一个比不写糟"
            error={fieldErrors.etymology}
          >
            <TextInput
              id="aw-etymology"
              value={etymologyInput}
              onChange={(e) => setEtymologyInput(e.target.value)}
              placeholder="ab-(离开) + rogare(提议) → 废除"
            />
          </Field>
        </Card>

        <Card>
          <div className="addword-section-head">
            <h2 className="addword-section-title">释义</h2>
            <p className="addword-section-hint muted">至少一条,词性 · 英文释义 · 中文释义均需填写</p>
          </div>
          {fieldErrors.meanings && (
            <p className="field__error" role="alert">
              {fieldErrors.meanings}
            </p>
          )}
          {fieldErrors.shares && (
            <p className="field__error" role="alert">
              {fieldErrors.shares}
            </p>
          )}
          <div className="addword-rows">
            {meanings.map((m, i) => (
              <div className="addword-row" key={m.key}>
                <div className="addword-row__grid addword-row__grid--meaning">
                  <Field label="词性" htmlFor={`aw-mean-pos-${i}`}>
                    <TextInput
                      id={`aw-mean-pos-${i}`}
                      value={m.pos}
                      onChange={(e) => updateMeaning(i, { pos: e.target.value })}
                      placeholder="v."
                      lang="en"
                    />
                  </Field>
                  <Field label="英文释义" htmlFor={`aw-mean-en-${i}`}>
                    <Textarea
                      id={`aw-mean-en-${i}`}
                      rows={2}
                      value={m.en}
                      onChange={(e) => updateMeaning(i, { en: e.target.value })}
                      lang="en"
                    />
                  </Field>
                  <Field label="中文释义" htmlFor={`aw-mean-zh-${i}`}>
                    <TextInput
                      id={`aw-mean-zh-${i}`}
                      value={m.zh}
                      onChange={(e) => updateMeaning(i, { zh: e.target.value })}
                      placeholder="待填写"
                    />
                  </Field>
                  {/* Share only makes sense when a word has multiple
                      meanings; with a single meaning the whole field is
                      absent (not just disabled): marking a single-sense
                      word 100% is noise, and it would also break the
                      "having a share implies multiple senses" invariant. */}
                  {meanings.length > 1 && (
                    <Field label="占比" htmlFor={`aw-mean-share-${i}`}>
                      <Select
                        id={`aw-mean-share-${i}`}
                        className="num"
                        value={m.share === undefined ? '' : String(m.share)}
                        onChange={(e) =>
                          updateMeaning(i, {
                            share: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">—</option>
                        {SHARE_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}%
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMeaning(i)}
                  disabled={meanings.length <= 1}
                  aria-label={`删除第 ${i + 1} 条释义`}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          {meanings.length > 1 && (
            <p className={`addword-share-total ${shareTotal === 100 ? 'muted' : 'field__error'}`} role="status">
              义项占比合计 <span className="num">{shareTotal}%</span>
              {shareTotal === 100 ? '' : ',需为 100%'}
            </p>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={addMeaning}>
            + 添加释义
          </Button>
        </Card>

        <Card>
          <div className="addword-section-head">
            <h2 className="addword-section-title">例句</h2>
            <p className="addword-section-hint muted">至少 2 句,建议贴近现代生活或工作场景</p>
          </div>
          {fieldErrors.examples && (
            <p className="field__error" role="alert">
              {fieldErrors.examples}
            </p>
          )}
          <div className="addword-rows">
            {examples.map((ex, i) => (
              <div className="addword-row" key={ex.key}>
                <Field label={`例句 ${i + 1}`} htmlFor={`aw-ex-${i}`}>
                  <Textarea
                    id={`aw-ex-${i}`}
                    rows={2}
                    value={ex.value}
                    onChange={(e) => updateExample(i, e.target.value)}
                    lang="en"
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeExample(i)}
                  disabled={examples.length <= 2}
                  aria-label={`删除例句 ${i + 1}`}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addExample}>
            + 添加例句
          </Button>
        </Card>

        <Card className="addword-stack">
          <Field label="近义词" htmlFor="aw-syn" hint="用逗号分隔,如 abolish, annul, repeal">
            <TextInput
              id="aw-syn"
              value={synonymsText}
              onChange={(e) => setSynonymsText(e.target.value)}
              lang="en"
            />
          </Field>
          <Field label="反义词" htmlFor="aw-ant" hint="用逗号分隔">
            <TextInput
              id="aw-ant"
              value={antonymsText}
              onChange={(e) => setAntonymsText(e.target.value)}
              lang="en"
            />
          </Field>
          <Field label="常见搭配" htmlFor="aw-col" hint="用逗号分隔">
            <TextInput
              id="aw-col"
              value={collocationsText}
              onChange={(e) => setCollocationsText(e.target.value)}
              lang="en"
            />
          </Field>
        </Card>

        <Card>
          <div className="addword-section-head">
            <h2 className="addword-section-title">同根变形</h2>
            <p className="addword-section-hint muted">可选,无则留空;词典不提供,需手动填写</p>
          </div>
          {fieldErrors.relatedForms && (
            <p className="field__error" role="alert">
              {fieldErrors.relatedForms}
            </p>
          )}
          {relatedForms.length > 0 && (
            <div className="addword-rows">
              {relatedForms.map((r, i) => (
                <div className="addword-row" key={r.key}>
                  <div className="addword-row__grid addword-row__grid--related">
                    <Field label="写法" htmlFor={`aw-rel-form-${i}`}>
                      <TextInput
                        id={`aw-rel-form-${i}`}
                        value={r.form}
                        onChange={(e) => updateRelated(i, { form: e.target.value })}
                        lang="en"
                      />
                    </Field>
                    <Field label="词性" htmlFor={`aw-rel-pos-${i}`}>
                      <TextInput
                        id={`aw-rel-pos-${i}`}
                        value={r.pos}
                        onChange={(e) => updateRelated(i, { pos: e.target.value })}
                        placeholder="n."
                        lang="en"
                      />
                    </Field>
                    <Field label="中文" htmlFor={`aw-rel-zh-${i}`}>
                      <TextInput
                        id={`aw-rel-zh-${i}`}
                        value={r.zh}
                        onChange={(e) => updateRelated(i, { zh: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRelated(i)}
                    aria-label={`删除第 ${i + 1} 条同根变形`}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={addRelated}>
            + 添加同根变形
          </Button>
        </Card>

        {fieldErrors.general && (
          <p className="field__error" role="alert">
            {fieldErrors.general}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={saving}
          disabled={saving || duplicate}
          aria-describedby={duplicate ? 'aw-headword-error' : undefined}
        >
          保存
        </Button>
      </form>
    </Page>
  )
}
