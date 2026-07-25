import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import type { AppState } from '../state/store'
import type { Meaning, RelatedForm, Word } from '../types'
import { lookupWord } from './dictionaryApi'
import './AddWord.css'

/** 表单里的一行释义:zh 永远由用户填,查词典只带回 pos/en */
type MeaningRow = Meaning
type RelatedRow = RelatedForm

const emptyMeaning = (): MeaningRow => ({ pos: '', en: '', zh: '' })
const emptyRelated = (): RelatedRow => ({ form: '', pos: '', zh: '' })

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; note?: string }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }

/** 逗号/顿号/换行分隔的自由文本 → 去空白、去空项、去重、剔除词条本身 */
function splitTagList(raw: string, headword: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[,,、\n]/)) {
    const v = piece.trim()
    if (!v || v.toLowerCase() === headword.toLowerCase()) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** 复用 Today 页的同步角标写法:synced 是静态文字,其余三态可点重试 */
function SyncNote({ status, message, onRetry }: { status: AppState['syncStatus']; message: string | null; onRetry: () => void }) {
  if (status === 'synced') return <p className="addword-saved__status muted">已同步到云端。</p>
  if (status === 'pending') return <p className="addword-saved__status muted">正在同步…</p>
  if (status === 'offline') return <p className="addword-saved__status muted">当前离线,联网后会自动同步。</p>
  return (
    <p className="addword-saved__status addword-saved__status--error">
      同步失败:{message ?? '未知错误'}
      <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
        重试同步
      </button>
    </p>
  )
}

/** Task 20 实现:输入单词 → 查询词典 API 预填 → 可编辑表单 → 保存。 */
export function AddWord() {
  const { words, saveWord, syncStatus, syncError, syncNow } = useApp()

  const [headwordInput, setHeadwordInput] = useState('')
  const [phonetic, setPhonetic] = useState('')
  const [meanings, setMeanings] = useState<MeaningRow[]>([emptyMeaning()])
  const [examples, setExamples] = useState<string[]>(['', ''])
  const [synonymsText, setSynonymsText] = useState('')
  const [antonymsText, setAntonymsText] = useState('')
  const [collocationsText, setCollocationsText] = useState('')
  const [relatedForms, setRelatedForms] = useState<RelatedRow[]>([])

  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedWord, setSavedWord] = useState<{ id: string; headword: string } | null>(null)

  const headword = headwordInput.trim()
  const id = headword.toLowerCase()
  const existing = useMemo(() => words.find((w) => w.id === id), [words, id])
  const duplicate = id !== '' && existing !== undefined

  const resetForm = () => {
    setHeadwordInput('')
    setPhonetic('')
    setMeanings([emptyMeaning()])
    setExamples(['', ''])
    setSynonymsText('')
    setAntonymsText('')
    setCollocationsText('')
    setRelatedForms([])
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
      setMeanings(result.meanings.length > 0 ? result.meanings.map((m) => ({ ...m, zh: '' })) : [emptyMeaning()])
      setLookup({
        status: 'done',
        note:
          result.meanings.length === 0 && !result.phonetic
            ? '词典没有可用的音标或释义,请手动填写。'
            : undefined,
      })
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
    setExamples((rows) => rows.map((r, idx) => (idx === i ? value : r)))
  const addExample = () => setExamples((rows) => [...rows, ''])
  const removeExample = (i: number) => setExamples((rows) => (rows.length <= 2 ? rows : rows.filter((_, idx) => idx !== i)))

  const updateRelated = (i: number, patch: Partial<RelatedRow>) =>
    setRelatedForms((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRelated = () => setRelatedForms((rows) => [...rows, emptyRelated()])
  const removeRelated = (i: number) => setRelatedForms((rows) => rows.filter((_, idx) => idx !== i))

  /**
   * 组装并校验。data/words.json 的 schema 比查词典给出的原始数据严格得多
   * （scripts/validate-words.ts):音标必须是 /.../ 形式,至少一条完整释义,
   * **例句至少 2 句**。这里把校验规则前移到表单里,而不是等保存后才在别处
   * 校验失败 —— 保存的词条必须能过 validate-words.ts,不留「先存后崩」的口子。
   */
  function validate(): Word | null {
    const errors: Record<string, string> = {}

    if (!headword) errors.headword = '请输入单词'
    else if (duplicate) errors.headword = '该词条已存在'

    const phon = phonetic.trim()
    if (!/^\/.+\/$/.test(phon)) errors.phonetic = '音标需形如 /ˈæbrəɡeɪt/(以斜杠包住)'

    const meaningRows = meanings
      .map((m) => ({ pos: m.pos.trim(), en: m.en.trim(), zh: m.zh.trim() }))
      .filter((m) => m.pos || m.en || m.zh)
    if (meaningRows.length === 0) errors.meanings = '至少需要一条释义'
    else if (meaningRows.some((m) => !(m.pos && m.en && m.zh)))
      errors.meanings = '每条释义的词性、英文释义、中文释义都要填写完整'

    const exampleRows = examples.map((e) => e.trim()).filter(Boolean)
    if (exampleRows.length < 2) errors.examples = `至少需要 2 句例句(当前 ${exampleRows.length} 句)`

    const relatedRows = relatedForms
      .map((r) => ({ form: r.form.trim(), pos: r.pos.trim(), zh: r.zh.trim() }))
      .filter((r) => r.form || r.pos || r.zh)
    if (relatedRows.some((r) => !(r.form && r.pos && r.zh)))
      errors.relatedForms = '同根变形的写法、词性、中文释义要么都填,要么整行留空'

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return null

    return {
      id,
      headword,
      phonetic: phon,
      meanings: meaningRows,
      examples: exampleRows,
      synonyms: splitTagList(synonymsText, headword),
      antonyms: splitTagList(antonymsText, headword),
      collocations: splitTagList(collocationsText, headword),
      relatedForms: relatedRows,
      sourceNote: 'manual',
      addedAt: todayStr(new Date()),
    }
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
          <SyncNote status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
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
      <form className="addword-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <Card className="addword-stack">
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
          <div className="addword-rows">
            {meanings.map((m, i) => (
              <div className="addword-row" key={i}>
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
              <div className="addword-row" key={i}>
                <Field label={`例句 ${i + 1}`} htmlFor={`aw-ex-${i}`}>
                  <Textarea
                    id={`aw-ex-${i}`}
                    rows={2}
                    value={ex}
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
                <div className="addword-row" key={i}>
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

        <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={saving || duplicate}>
          保存
        </Button>
      </form>
    </Page>
  )
}
