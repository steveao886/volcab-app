import { afterEach, describe, expect, it } from 'vitest'
import { isEditableTarget, optionIndexFromKey } from './keys'

/**
 * 快捷键的判断逻辑测在这里,而不是在页面上做组件测试 ——
 * 「UI 本身不写组件测试」那条约定依然成立(见 store.test.tsx 顶部)。
 * 页面那一层只剩「把下标映射到选项并调用 choose」这一句,值得测的分支
 * (修饰键、越界、输入框里)全在这个纯函数里。
 */

/** 造一个按键事件。默认不带任何修饰键。 */
function key(k: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, ...mods })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isEditableTarget', () => {
  it('null 不算', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  it('input / textarea / select 都算', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('contentEditable 也算', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    document.body.append(el)
    expect(isEditableTarget(el)).toBe(true)
  })

  it('普通按钮不算 —— 否则 Tab 到选项上就再也用不了数字键', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
  })
})

describe('optionIndexFromKey', () => {
  it('1–4 映射到 0–3', () => {
    expect(optionIndexFromKey(key('1'), 4)).toBe(0)
    expect(optionIndexFromKey(key('4'), 4)).toBe(3)
  })

  it('超出选项数量返回 -1', () => {
    expect(optionIndexFromKey(key('5'), 4)).toBe(-1)
  })

  it('0 与非数字键返回 -1', () => {
    for (const k of ['0', 'Enter', ' ', 'a', 'F1', 'ArrowDown']) {
      expect(optionIndexFromKey(key(k), 4)).toBe(-1)
    }
  })

  it('Ctrl / Cmd / Alt 组合放过 —— 那是浏览器切标签页', () => {
    expect(optionIndexFromKey(key('1', { ctrlKey: true }), 4)).toBe(-1)
    expect(optionIndexFromKey(key('1', { metaKey: true }), 4)).toBe(-1)
    expect(optionIndexFromKey(key('1', { altKey: true }), 4)).toBe(-1)
  })

  it('Shift 不排除 —— AZERTY 上数字本来就要按 Shift', () => {
    expect(optionIndexFromKey(key('1', { shiftKey: true }), 4)).toBe(0)
  })

  it('焦点在输入框里时一律返回 -1', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(optionIndexFromKey(key('1'), 4)).toBe(-1)
  })
})
