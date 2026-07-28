import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Select } from '../components/Select'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'
import { normalizeEtymology, validateEtymology } from '../lib/etymology'
import {
  SHARE_OPTIONS,
  USAGE_SCORE_OPTIONS,
  normalizeMeanings,
  shareSum,
  validateShares,
} from '../lib/senseShare'
import type { Meaning, Word } from '../types'

/**
 * 词条编辑表单。
 *
 * 这里暴露 meanings(含义项占比)/examples/synonyms/antonyms/collocations/
 * usageScore 可编辑 —— id/headword/phonetic/relatedForms/sourceNote/addedAt
 * 一律原样保留,提交时以 `{ ...word, ...编辑过的字段 }` 的方式合并,不会被表单
 * 未展示的字段静默吞掉。
 *
 * usageScore 与义项占比必须在这里可改,而不是只让 /add 能填:否则填错了无从
 * 修正,而且 share 会被下面重建 meanings 的那一步静默抹掉 —— 用户只是改个错别字,
 * 占比就没了。
 *
 * synonyms/antonyms/collocations 是扁平字符串数组,用「每行一个」的单个
 * Textarea 编辑,而不是逐条 add/remove 的控件组 —— meanings 才值得那份
 * 复杂度(它是结构化的 pos/en/zh 三元组),三个平铺列表没必要照搬。
 *
 * 两个 <legend> 用 .worddetail-section-title(与本页只读态的「例句」「近义词」
 * 等小节标题同一个类),不是 .pos —— .pos 是词性标签,结构性分区不该用朱砂。
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
 * 一行一条,顺带剔除与词头相同的项 —— scripts/validate-words.ts 明确要求
 * synonyms/antonyms/collocations 不得包含词条本身。
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
  // 老词条可能没有 usageScore(那时它还是可选字段),此时空串 = 未评分,
  // 用户必须选一个才能保存 —— 编辑一次就顺手把它补齐。
  const [usageScoreInput, setUsageScoreInput] = useState(() =>
    word.usageScore === undefined ? '' : String(word.usageScore),
  )
  // 词源与 usageScore 相反:空串是合法的终态,不是「待补齐」。清空即删除该字段。
  const [etymologyInput, setEtymologyInput] = useState(() => word.etymology ?? '')
  const [error, setError] = useState<string | null>(null)

  // 实时提示用;真正拦提交的是 handleSubmit 里的 validateShares。
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

    // normalizeMeanings 在这里同时干两件事:把只剩一条释义时的残留 share 剥掉
    // (用户删到只剩一条,它就不该再有占比),以及按占比降序重排 —— 与
    // scripts/validate-words.ts 要求的存储不变式对齐,不必麻烦用户自己排。
    const cleanedMeanings: Meaning[] = normalizeMeanings(
      meanings
        .map(m => {
          const row: Meaning = { pos: m.pos.trim(), en: m.en.trim(), zh: m.zh.trim() }
          if (m.share !== undefined) row.share = m.share
          return row
        })
        .filter(m => m.pos !== '' || m.en !== '' || m.zh !== ''),
    )

    if (cleanedMeanings.length === 0) {
      setError('至少需要保留一条释义(词性、英文、中文都要填写)。')
      return
    }
    const incomplete = cleanedMeanings.findIndex(m => m.pos === '' || m.en === '' || m.zh === '')
    if (incomplete !== -1) {
      setError(`第 ${incomplete + 1} 条释义需要同时填写词性、英文与中文。`)
      return
    }

    const shareErr = validateShares(cleanedMeanings)
    if (shareErr) {
      setError(shareErr)
      return
    }

    if (usageScoreInput === '') {
      setError('请选择当代遇见概率(1–10)。')
      return
    }

    // 校验必须和 scripts/validate-words.ts 对齐,否则这里存下的词条会让
    // data/words.json 悄悄脱离 schema —— app 自己的 isWord 更宽松,不会报错,
    // 等到跑校验脚本时才发现。添加新词页(AddWord)已经这么做了,编辑页
    // 是另一个 agent 写的,当时漏了这两条。
    const cleanedExamples = examples.map(e => e.value.trim()).filter(v => v !== '')
    if (cleanedExamples.length < 2) {
      setError(`至少需要 2 句例句(当前 ${cleanedExamples.length} 句)。`)
      return
    }

    // 同义/反义/搭配都不应该包含词条本身
    const synonyms = linesToArray(synonymsText, word.headword)
    const antonyms = linesToArray(antonymsText, word.headword)
    const collocations = linesToArray(collocationsText, word.headword)

    const etymologyErr = validateEtymology(etymologyInput)
    if (etymologyErr) {
      setError(etymologyErr)
      return
    }

    setError(null)
    const updated: Word = {
      ...word,
      meanings: cleanedMeanings,
      examples: cleanedExamples,
      synonyms,
      antonyms,
      collocations,
      usageScore: Number(usageScoreInput),
    }
    // 清空输入框要真的把键删掉,不能留一个 `etymology: undefined`:内存里那个对象
    // 会带着这个键流进 store、进而进 merge —— JSON 序列化时它确实会消失,但在此
    // 之前任何 `'etymology' in word` 式的判断都会看到它。删得干净些。
    const etymology = normalizeEtymology(etymologyInput)
    if (etymology === undefined) delete updated.etymology
    else updated.etymology = etymology

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
            {/* 占比只在一词多义时出现:单义词标 100% 是噪音,还会让
                「有 share 即多义词」这条判断失效。 */}
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
