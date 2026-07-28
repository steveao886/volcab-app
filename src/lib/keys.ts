/**
 * 键盘快捷键的共用判断。
 *
 * 复习页用 1–4 打分,测验页用 1–4 选选项 —— 两处各挂着一个 window keydown
 * 监听。「什么时候**不**该接管按键」这条判断必须只有一份:一旦分叉,就会出现
 * 「复习页在输入框里按 3 没事,测验页却把 3 吃掉」这种只在某一页复现的怪毛病。
 */

/**
 * 焦点是否落在文本输入控件里 —— 是的话按键必须留给输入本身。
 *
 * 复习页与测验的选择题当下都没有输入框,但拼写题有,而且以后随便哪一页加个
 * 搜索框,少了这层判断就是「打字打不出数字」。
 */
export function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/** 只认主键盘/小键盘上的 1–9,别的键一律不接管。 */
const DIGIT = /^[1-9]$/

/**
 * 把一次按键翻译成选项下标(按 1 得 0)。不是可用的数字键时返回 -1。
 *
 * 两条刻意的取舍:
 * - **带 Ctrl / Cmd / Alt 的组合一律放过** —— Cmd+1、Ctrl+1 是浏览器切标签页,
 *   抢过来会让人以为浏览器坏了。
 * - **不看 Shift** —— AZERTY 之类的布局上数字本来就要按 Shift 才打得出,
 *   把 Shift 一并排除等于让这些键盘用不了快捷键。
 */
export function optionIndexFromKey(e: KeyboardEvent, count: number): number {
  if (e.ctrlKey || e.metaKey || e.altKey) return -1
  if (!DIGIT.test(e.key)) return -1
  if (isEditableTarget(document.activeElement)) return -1
  const i = Number(e.key) - 1
  return i < count ? i : -1
}
