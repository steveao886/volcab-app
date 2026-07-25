import type { Progress, Word, WordState } from '../types'

/** 状态筛选 chip 的取值;'all' 不过滤。 */
export type StatusFilter = 'all' | WordState

export interface LibraryFilterOptions {
  query: string
  status: StatusFilter
  /** null = 不限来源笔记;否则精确匹配 Word.sourceNote */
  sourceNote: string | null
}

/**
 * progress.words 里没有记录的词条视为 'new' —— 与 buildQueue 的判定口径一致。
 * 导出给 Library(行状态点)与 WordDetail(学习状态统计)共用,避免两处各写一遍。
 */
export function wordState(word: Word, progress: Progress): WordState {
  return progress.words[word.id]?.state ?? 'new'
}

function matchesStatus(word: Word, progress: Progress, status: StatusFilter): boolean {
  return status === 'all' || wordState(word, progress) === status
}

function matchesSourceNote(word: Word, sourceNote: string | null): boolean {
  return sourceNote === null || word.sourceNote === sourceNote
}

/**
 * 搜索命中档位,数字越小排序越靠前:
 *   0 词头前缀   1 词头子串(非前缀)   2 仅释义(en/zh)子串命中
 * 空查询视为「全部命中」,统一给档位 0,实际排序退化为纯字母序。
 * 返回 null 表示未命中,调用方据此从结果里剔除。
 */
function searchRank(word: Word, needle: string): 0 | 1 | 2 | null {
  if (needle === '') return 0
  const headword = word.headword.toLowerCase()
  if (headword.startsWith(needle)) return 0
  if (headword.includes(needle)) return 1
  for (const m of word.meanings) {
    // zh 也要转小写:中文释义里混着拉丁字母的情况不少(AI、CEO、DNA……),
    // needle 已经是小写,这边不转就等于对这些词做了大小写敏感匹配。
    if (m.en.toLowerCase().includes(needle) || m.zh.toLowerCase().includes(needle)) return 2
  }
  return null
}

/**
 * 词库搜索 + 筛选的纯函数核心。
 *
 * 组合方式:搜索关键词、状态 chip、sourceNote chip 三者按 AND 组合 ——
 * 都得满足才保留,这是最符合直觉的读法,也是产品里唯一提过的用法。
 *
 * 排序:无搜索词时按词头字母序;有搜索词时先按命中档位(词头前缀 >
 * 词头子串 > 仅释义命中),同档位内再按词头字母序,让最贴近输入的词
 * 排在最前面,而不是维持词库原始顺序。
 */
export function filterWords(words: Word[], progress: Progress, opts: LibraryFilterOptions): Word[] {
  const needle = opts.query.trim().toLowerCase()
  const scored: { word: Word; rank: 0 | 1 | 2 }[] = []
  for (const word of words) {
    if (!matchesStatus(word, progress, opts.status)) continue
    if (!matchesSourceNote(word, opts.sourceNote)) continue
    const rank = searchRank(word, needle)
    if (rank === null) continue
    scored.push({ word, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.word.headword.localeCompare(b.word.headword))
  return scored.map(s => s.word)
}

/**
 * 词库里出现过的所有 sourceNote,去重。
 * 大多数值是 Evernote 笔记的行区间(如 "8-11"),按起始数字升序排列比
 * 字符串字典序更符合直觉("104-106" 不该排在 "12-15" 前面);
 * 无法解析出数字的值(如手动添加词条的 "manual")统一排在末尾,按字母序。
 */
export function distinctSourceNotes(words: Word[]): string[] {
  const set = new Set(words.map(w => w.sourceNote))
  return [...set].sort((a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    const aNum = !Number.isNaN(na)
    const bNum = !Number.isNaN(nb)
    if (aNum && bNum && na !== nb) return na - nb
    if (aNum !== bNum) return aNum ? -1 : 1
    return a.localeCompare(b)
  })
}
