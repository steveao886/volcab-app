export interface Meaning { pos: string; en: string; zh: string }

/** 同根变形:未单独收词,但在词条页展示,便于成族记忆 */
export interface RelatedForm { form: string; pos: string; zh: string }

export interface Word {
  id: string          // 词元小写,唯一
  headword: string
  phonetic: string    // 美式,形如 /ˈæbrəɡeɪt/
  meanings: Meaning[]
  examples: string[]  // 2-3 句现代生活/工作场景例句
  synonyms: string[]
  antonyms: string[]
  collocations: string[]
  relatedForms: RelatedForm[]  // 同根变形,无则空数组
  sourceNote: string  // 来源笔记标题,手动添加为 "manual"
  addedAt: string     // YYYY-MM-DD
  /** 当代遇见概率 1–10:在真实语境里碰到这个词的可能性。缺省表示尚未评分。 */
  usageScore?: number
}

export interface WordsFile { version: 1; words: Word[] }

export type WordState = 'new' | 'learning' | 'review'
export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface ProgressEntry {
  state: WordState
  ease: number
  intervalDays: number
  due: string            // YYYY-MM-DD
  stepIndex: number      // learning 步长下标;review 阶段置 0
  reps: number
  lapses: number
  lastReviewedAt: string // ISO 时间戳,冲突合并的依据
}

export interface DailyStat { reviewed: number; newLearned: number; correct: number; quizTaken: number }

export interface Progress {
  version: 1
  /**
   * soundEnabled 可选,undefined 视为 true(默认开启,见 src/lib/sound.ts
   * 的 isSoundEnabled)。这不是随手偷懒——用户真实的 progress.json 在同步
   * 中,加一个必填字段要么校验不过,要么逼一次迁移;可选字段两台设备
   * 各自缺省为「开」,天然兼容,不需要动 sync.ts 的 isWord/校验逻辑。
   */
  /**
   * updatedAt 是设置的「最后修改时刻」(ISO),合并时据此判优 —— 没有它,
   * settings 在两台设备之间永远同步不了:谁拉下来都以本地为准,互相覆盖。
   * 可选:旧数据与从未改过设置的设备没有这个字段,视为「最旧」,自动让位给
   * 改过的那一方。整个 settings 作为一个整体搬运,不逐字段挑。
   */
  settings: { newPerDay: number; soundEnabled?: boolean; updatedAt?: string }
  words: Record<string, ProgressEntry>
  dailyStats: Record<string, DailyStat>
}

export const emptyProgress = (): Progress => ({
  version: 1,
  settings: { newPerDay: 10 },
  words: {},
  dailyStats: {},
})

export const emptyStat = (): DailyStat => ({ reviewed: 0, newLearned: 0, correct: 0, quizTaken: 0 })

/**
 * 生词暂存区(staging)的一条待补全记录。
 *
 * **只有两个字段**,这是刻意的:捕获必须保持「一个输入框」的成本,备注、来源、
 * 词典预查一律不做,其余字段全部由会话中的 AI 事后补全(设计文档 §6.2)。
 */
export interface StagingItem {
  headword: string   // 用户输入的原样写法(去首尾空白、内部空白折成一个空格)
  addedAt: string    // YYYY-MM-DD
}

/** volcab-data 里的第三个文件 staging.json */
export interface StagingFile { version: 1; items: StagingItem[] }
