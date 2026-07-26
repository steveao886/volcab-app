import { readFileSync } from 'node:fs'

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
  // usageScore 可选(App 内手动添加的词不会有分),但存在就必须合法 ——
  // 缺省表示「尚未评分」,详情页据此不渲染该格;0 或 11 这类值会渲染出一个假分数。
  if (w.usageScore !== undefined && (!Number.isInteger(w.usageScore) || w.usageScore < 1 || w.usageScore > 10)) {
    errors.push(`${ctx}: usageScore 需为 1–10 的整数,实为 ${JSON.stringify(w.usageScore)}`)
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`OK: ${data.words.length} 个词条通过校验`)
