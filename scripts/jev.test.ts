import { describe, expect, it } from 'vitest'
import { mapPool, readKey } from './jev'

describe('readKey', () => {
  it('prefers the environment over .env.local', () => {
    expect(readKey('TYPESAFE_API_KEY=from-file\n', 'from-env')).toBe('from-env')
  })
  it('reads the key line from .env.local, skipping comments and quotes', () => {
    expect(readKey('# TYPESAFE_API_KEY=commented\r\nTYPESAFE_API_KEY="abc"\r\n', undefined)).toBe('abc')
  })
  it('is undefined when the line is empty or the file is missing', () => {
    expect(readKey('TYPESAFE_API_KEY=\n', undefined)).toBeUndefined()
    expect(readKey(undefined, undefined)).toBeUndefined()
    expect(readKey(undefined, '  ')).toBeUndefined()
  })
})

describe('mapPool', () => {
  it('returns results in input order whatever order they finish in', async () => {
    const out = await mapPool([30, 10, 20], 3, (ms) => new Promise<number>((r) => setTimeout(() => r(ms), ms)))
    expect(out).toEqual([30, 10, 20])
  })
  it('never runs more than the limit at once', async () => {
    let live = 0, peak = 0
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 5))
      live--
    })
    expect(peak).toBe(2)
  })
  it('rejects when any call fails', async () => {
    await expect(mapPool([1, 2], 2, async (n) => { if (n === 2) throw new Error('boom'); return n })).rejects.toThrow('boom')
  })
})
