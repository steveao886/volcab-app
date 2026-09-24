import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, parseThemePref, readThemePref, resolveTheme, THEME_COLOR, THEME_KEY, writeThemePref } from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = ''
})

describe('parseThemePref', () => {
  it('reads the two explicit choices', () => {
    expect(parseThemePref('light')).toBe('light')
    expect(parseThemePref('dark')).toBe('dark')
  })
  it('treats anything else — absent, junk, a stale value — as following the system', () => {
    expect(parseThemePref(null)).toBe('system')
    expect(parseThemePref('')).toBe('system')
    expect(parseThemePref('"dark"')).toBe('system')
    expect(parseThemePref('sepia')).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('follows the system only when the choice is 跟随系统', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
  it('an explicit choice overrides the system either way', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('readThemePref / writeThemePref', () => {
  it('round-trips an explicit choice', () => {
    writeThemePref('dark')
    expect(readThemePref()).toBe('dark')
  })
  it('跟随系统 is stored as no key at all, so a device that never chose reads the same as one that went back', () => {
    writeThemePref('light')
    writeThemePref('system')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(readThemePref()).toBe('system')
  })
})

describe('applyTheme', () => {
  it('sets data-theme on <html> and points every theme-color meta at that theme\'s paper', () => {
    for (let i = 0; i < 2; i++) {
      const m = document.createElement('meta')
      m.name = 'theme-color'
      m.content = '#000000'
      document.head.appendChild(m)
    }
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
    expect(metas.map(m => m.content)).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(metas.map(m => m.content)).toEqual([THEME_COLOR.light, THEME_COLOR.light])
  })
})
