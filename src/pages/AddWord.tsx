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
import { SyncStatus } from '../components/SyncStatus'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import type { Meaning, RelatedForm, Word } from '../types'
import { lookupWord } from './dictionaryApi'
import { checkCapture } from './stagingCapture'
import type { CaptureCheck } from './stagingCapture'
import './AddWord.css'

/**
 * 表单里可重复的行:比 Word 对应类型多一个稳定 key,专供 React 列表用,
 * 提交前 validate() 会重新拼一份干净对象,不会带着 key 存进 Word。
 * 用数组下标当 React key 在删除中间行时会导致 DOM 节点复用错位
 * （光标位置、组合输入法状态跟着挪到别的行上),所以每行在创建时领一个
 * 单调递增的号,删除、增加都不影响其余行的号。
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

/** 快速收词的拦截提示。抽出来只是为了不在 JSX 里套三层三元表达式。 */
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

/** 逗号(半角/全角)/顿号/换行分隔的自由文本 → 去空白、去空项、去重、剔除词条本身 */
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
 * Task 20 实现:输入单词 → 查询词典 API 预填 → 可编辑表单 → 保存。
 * v1.1 E:页面顶部加一块「快速收词」—— 手机上看到生词的那一刻,只记单词就走,
 * 其余十个字段留给会话中的 AI 批量补全(设计文档 §6.3)。完整表单原样留在下方。
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

  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedWord, setSavedWord] = useState<{ id: string; headword: string } | null>(null)

  const headword = headwordInput.trim()
  // 词库约定(见计划 Task 10 步骤 2.5):含空格的短语词条 id 用连字符,如
  // "ad hoc" → "ad-hoc",与 data/words.json 里 due-diligence 等一致。
  // headword 本身照常保留空格显示,只有 id 折叠。
  const id = headword.toLowerCase().replace(/\s+/g, '-')
  const existing = useMemo(() => words.find((w) => w.id === id), [words, id])
  const duplicate = id !== '' && existing !== undefined

  const capture = useMemo(() => checkCapture(captureInput, words, staging), [captureInput, words, staging])

  async function handleCapture() {
    if (capture.kind !== 'ok' || capturing) return
    const added = capture.headword
    setCapturing(true)
    try {
      // addStaging 先本地入列再推送,推送成败由下面常驻的 SyncStatus 说明 ——
      // 离线时词已经在本机队列里了,联网后自动并上去,不需要用户重来一次。
      await addStaging(added)
      setCaptureInput('')
      setCaptured(added)
    } finally {
      setCapturing(false)
    }
  }

  function handleCaptureKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 这块不在 <form> 里(下方还有一个完整表单,套嵌套 form 是非法的),
    // 所以回车提交要自己接 —— 手机上「一个输入框 + 回车」才是最快的收词路径。
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
      // 音标和释义是词典分别提供的,不是同进同出(如 abrogate:有释义、无音标)——
      // 分别判断,措辞照实说,别让通用的「都填好了」文案在只填了一半时说谎。
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

    const exampleRows = examples.map((e) => e.value.trim()).filter(Boolean)
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
      {/* 快速收词在最上面,是打开这一页默认看到的东西:捕获必须保持一个输入框的
          成本。它**不能**放进下面那个 <form> 里 —— 嵌套 form 是非法的,而且回车
          会误触整个词条的保存。完整表单原样留在下方,给「我现在就想填完」的场景。 */}
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
