import { describe, expect, it } from 'vitest'
import { ETYMOLOGY_MAX, normalizeEtymology, validateEtymology } from './etymology'

describe('normalizeEtymology', () => {
  it('empty string and whitespace-only both become undefined — an empty string would make the display layer think there is an etymology and render an empty title', () => {
    expect(normalizeEtymology('')).toBeUndefined()
    expect(normalizeEtymology('   ')).toBeUndefined()
    expect(normalizeEtymology('\n\t ')).toBeUndefined()
  })

  it('leading/trailing whitespace is trimmed, everything else is kept as-is', () => {
    expect(normalizeEtymology('  ab-(离开) + rogare(提议) → 废除  ')).toBe('ab-(离开) + rogare(提议) → 废除')
  })

  it('internal whitespace is left alone — root breakdowns rely on spaces to separate segments', () => {
    expect(normalizeEtymology('mis-(坏) + anthrōpos(人) → 厌恶人类的')).toBe('mis-(坏) + anthrōpos(人) → 厌恶人类的')
  })
})

describe('validateEtymology', () => {
  it('leaving it blank is valid — this is the one field you are better off not filling in', () => {
    expect(validateEtymology('')).toBeNull()
    expect(validateEtymology('    ')).toBeNull()
  })

  it('exactly 60 characters passes', () => {
    expect(validateEtymology('词'.repeat(ETYMOLOGY_MAX))).toBeNull()
  })

  it('61 characters is rejected, and the actual character count is included in the error', () => {
    const err = validateEtymology('词'.repeat(ETYMOLOGY_MAX + 1))
    expect(err).not.toBeNull()
    expect(err).toContain(String(ETYMOLOGY_MAX + 1))
  })

  it('length is measured after trimming, not by the raw input length — otherwise a few trailing spaces could make a valid input look too long', () => {
    expect(validateEtymology('词'.repeat(ETYMOLOGY_MAX) + '     ')).toBeNull()
  })
})
