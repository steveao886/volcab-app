import { readFileSync } from 'node:fs'
import { ETYMOLOGY_MAX } from '../src/lib/etymology.ts'
import { isShareOrdered, validateShares } from '../src/lib/senseShare.ts'

const file = process.argv[2] ?? 'data/words.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors: string[] = []

if (data.version !== 1) errors.push('version 必须为 1')
if (!Array.isArray(data.words)) { console.error('words 必须是数组'); process.exit(1) }

const seen = new Set<string>()
for (const w of data.words) {
  const ctx = w.id ?? '(缺 id)'
  if (!w.id || w.id !== String(w.id).toLowerCase().trim()) errors.push(`${ctx}: id 必须为小写且无空白`)
  if (seen.has(w.id)) errors.push(`${ctx}: id 重复`)
  seen.add(w.id)
  if (!w.headword) errors.push(`${ctx}: 缺 headword`)
  if (!/^\/.+\/$/.test(w.phonetic ?? '')) errors.push(`${ctx}: phonetic 需形如 /.../`)
  if (!Array.isArray(w.meanings) || w.meanings.length === 0) errors.push(`${ctx}: meanings 为空`)
  for (const m of w.meanings ?? []) {
    if (!m.pos || !m.en || !m.zh) errors.push(`${ctx}: meaning 缺 pos/en/zh`)
  }
  // 义项占比:规则与两个表单共用同一份实现(src/lib/senseShare.ts),
  // 免得脚本和 App 各写一份、日后悄悄漂移。
  if (Array.isArray(w.meanings)) {
    const shareErr = validateShares(w.meanings)
    if (shareErr) errors.push(`${ctx}: ${shareErr}`)
    else if (!isShareOrdered(w.meanings)) errors.push(`${ctx}: 义项须按占比从高到低排列`)
  }
  if (!Array.isArray(w.examples) || w.examples.length < 2) errors.push(`${ctx}: examples 至少 2 句`)
  for (const k of ['synonyms', 'antonyms', 'collocations'] as const) {
    if (!Array.isArray(w[k])) errors.push(`${ctx}: ${k} 必须是数组`)
    else if (w[k].includes(w.headword)) errors.push(`${ctx}: ${k} 不应包含词条本身`)
  }
  if (!Array.isArray(w.relatedForms)) errors.push(`${ctx}: relatedForms 必须是数组`)
  for (const r of w.relatedForms ?? []) {
    if (!r.form || !r.pos || !r.zh) errors.push(`${ctx}: relatedForm 缺 form/pos/zh`)
  }
  if (!w.sourceNote) errors.push(`${ctx}: 缺 sourceNote`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.addedAt ?? '')) errors.push(`${ctx}: addedAt 需为 YYYY-MM-DD`)
  // usageScore 现在是**必填**:两个录入表单都要求填,词条补全流程也一并产出
  // (见 docs/word-entry-spec.md)。当初设为可选是因为 App 内手动添加的词拿不到
  // 分数;那条路已经堵上了,再放行等于允许新词悄悄缺分数、复习时那一行不显示。
  // 注意 src/types.ts 与 sync.ts 仍按可选处理 —— 写入端严格、读取端宽容。
  if (w.usageScore === undefined) {
    errors.push(`${ctx}: 缺 usageScore(1–10 的整数)`)
  } else if (!Number.isInteger(w.usageScore) || w.usageScore < 1 || w.usageScore > 10) {
    errors.push(`${ctx}: usageScore 需为 1–10 的整数,实为 ${JSON.stringify(w.usageScore)}`)
  }
  // etymology 与上面那些字段相反:**不校验是否存在,只校验存在时的形状**。
  // 词源不是每个词都有(见 src/types.ts 的字段注释),缺席是合法状态;
  // 但一个空串或纯空白的 etymology 是脏数据 —— 它会让展示层判为"有词源"
  // 然后渲染一个空的小节标题。
  if (w.etymology !== undefined) {
    if (typeof w.etymology !== 'string' || w.etymology.trim() === '') {
      errors.push(`${ctx}: etymology 存在时必须是非空字符串(不需要词源就整个字段不写)`)
    } else if (w.etymology.length > ETYMOLOGY_MAX) {
      errors.push(`${ctx}: etymology 超过 ${ETYMOLOGY_MAX} 字(实为 ${w.etymology.length}),它是一句话不是一段考据`)
    }
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`OK: ${data.words.length} 个词条通过校验`)
