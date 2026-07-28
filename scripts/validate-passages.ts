/**
 * 短文语料的写入端闸门。校验不过不进仓库。
 *
 * 运行:npm run validate-passages
 *
 * 读取端(lib/passage.ts)对坏数据是宽容的 —— 跳过那一篇,不抛错不白屏。
 * 那是不白屏的兜底,不是质量保证;质量保证在这里。
 */
import { readFileSync } from 'node:fs'
import { isInflectionOf } from '../src/lib/headword.ts'

/** 每篇至少标记多少个词。挖空只挖学过的,标记少了早期一篇也凑不出 3 个空。 */
const MIN_MARKS = 6

const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

// 与 validate-words.ts 一致:脚本里不套类型,校验的对象本来就可能不合形状
const words = JSON.parse(readFileSync('data/words.json', 'utf8'))
const file = JSON.parse(readFileSync('src/data/passages.json', 'utf8'))

if (file.version !== 1) { console.error('version 必须为 1'); process.exit(1) }
if (!Array.isArray(file.passages)) { console.error('passages 必须是数组'); process.exit(1) }

const byId = new Map<string, { headword: string }>(
  words.words.map((w: { id: string; headword: string }) => [w.id, w]),
)
const errors: string[] = []
const seenIds = new Set<string>()
const useCount = new Map<string, number>()

for (const p of file.passages) {
  const at = (msg: string) => errors.push(`[${p.id}] ${msg}`)

  // 形状先兜一层,否则下面 p.en.entries() 会抛出一个看不出哪篇出问题的栈
  if (typeof p.id !== 'string' || typeof p.title !== 'string'
      || !Array.isArray(p.en) || !Array.isArray(p.zh)) {
    errors.push(`[${String(p.id)}] 缺 id / title / en / zh,或类型不对`)
    continue
  }

  if (!/^[a-z0-9-]+$/.test(p.id)) at('id 只允许小写字母、数字与连字符')
  if (seenIds.has(p.id)) at('id 重复')
  seenIds.add(p.id)

  if (p.title.trim() === '') at('title 不能为空')
  if (p.en.length === 0) at('en 不能为空')
  if (p.en.length !== p.zh.length) at(`中英句数对不上:en ${p.en.length} 句,zh ${p.zh.length} 句`)

  let marks = 0
  for (const [si, sentence] of p.en.entries()) {
    // 先把合法标记摘掉,残留花括号说明写坏了
    const stripped = sentence.replace(MARKER, '')
    if (/[{}]/.test(stripped)) at(`第 ${si + 1} 句有畸形标记`)

    for (const m of sentence.matchAll(MARKER)) {
      marks += 1
      const wordId = m[1].trim()
      const surface = (m[2] ?? m[1]).trim()
      const w = byId.get(wordId)
      if (w === undefined) {
        at(`第 ${si + 1} 句引用了词库里没有的 ${wordId}`)
        continue
      }
      if (!isInflectionOf(surface, w.headword)) {
        at(`第 ${si + 1} 句:「${surface}」不是 ${w.headword} 的变形`)
      }
      useCount.set(wordId, (useCount.get(wordId) ?? 0) + 1)
    }
  }
  if (marks < MIN_MARKS) at(`只标记了 ${marks} 个词,至少要 ${MIN_MARKS} 个`)
}

// --- 覆盖分布报告(不算错误,是给下一批语料的输入) ---
const covered = [...useCount.keys()].length
console.log(`短文 ${file.passages.length} 篇,覆盖 ${covered} / ${words.words.length} 个词`)
const multi = [...useCount.values()].filter(c => c >= 3).length
console.log(`其中出现 3 次以上的:${multi} 个`)

if (errors.length > 0) {
  console.error(`\n校验不通过,共 ${errors.length} 条:`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}
console.log('校验通过')
