import type { WordIssue, WordIssueCode } from '../lib/wordValidate'
import { formatWordIssue } from '../lib/wordValidate'

/**
 * The Chinese sentences the two entry forms show for each rule in
 * `src/lib/wordValidate.ts`. The script keeps its own English map; see that
 * module's header for why one function cannot return both.
 *
 * Typed `Record<WordIssueCode, string>` on purpose: **that is the
 * exhaustiveness check**. Adding a rule without a message is a compile error,
 * which is the whole guard against a rule silently blocking a save with no
 * text on screen. Never widen it to `Partial`.
 *
 * Wording is carried over verbatim from whichever form showed it before, so
 * the rendered UI does not move. Two entries are just `{detail}`: the message
 * for those belongs to the rule module that owns the field (`senseShare.ts`,
 * `etymology.ts`) and is already Chinese, so restating it here would recreate
 * exactly the duplication this refactor removed.
 */
export const WORD_ISSUE_TEXT: Record<WordIssueCode, string> = {
  'id.empty': '词条 id 缺失',
  'id.format': 'id 只能是小写字母且不含空格',
  'headword.empty': '请输入单词',
  'phonetic.notSlashed': '音标需形如 /ˈæbrəɡeɪt/(以斜杠包住)',
  'meanings.empty': '至少需要一条释义',
  'meanings.incomplete': '第 {detail} 条释义需要同时填写词性、英文与中文',
  'meanings.phoneticNotSlashed': '义项音标需形如 /ˈæbrəɡeɪt/(以斜杠包住)',
  'meanings.speakAsInvalid': '义项的朗读拼写不能留空',
  'meanings.speakAsIsIpa': '义项的朗读拼写是给语音合成用的近似拼法,不是音标,不要写斜杠',
  'meanings.speakAsWithoutPhonetic': '这条义项有朗读拼写却没有音标 —— 没有音标,拼法就无从谈起',
  // Neither form can enter a per-sense phonetic, so these two say where the
  // fix has to happen instead of leaving the user clicking 保存 forever. They
  // fire only when a second sense is added to a heteronym — for example an
  // adj. sense on one of the library's 33 single-sense -ate verbs.
  'heteronym.phoneticRequired': '这个词不同义项读音不同,读音不同的义项需要单独标注音标;本表单填不了,请在词库数据里补全',
  'heteronym.speakAsRequired': '单独标了音标的义项没有录音可播,还需要一条给语音合成用的朗读拼写;本表单填不了,请在词库数据里补全',
  'share.invalid': '{detail}',
  'share.unordered': '释义需按义项占比从高到低排列',
  'examples.tooFew': '至少需要 2 句例句(当前 {detail} 句)',
  'wordList.notArray': '近义词、反义词、常见搭配都必须是列表',
  'wordList.includesHeadword': '近义词、反义词、常见搭配都不能包含词条本身',
  'relatedForms.notArray': '同根变形必须是列表',
  'relatedForms.partial': '同根变形的写法、词性、中文释义要么都填,要么整行留空',
  'sourceNote.empty': '词条缺少来源笔记',
  'addedAt.format': '添加日期需为 YYYY-MM-DD',
  'usageScore.missing': '请选择当代遇见概率',
  'usageScore.range': '当代遇见概率需为 1–10 的整数',
  'etymology.empty': '词源要么写完整,要么整条留空',
  'etymology.tooLong': '{detail}',
}

/** One issue, rendered for the user. */
export const wordIssueMessage = (issue: WordIssue): string => formatWordIssue(issue, WORD_ISSUE_TEXT)
