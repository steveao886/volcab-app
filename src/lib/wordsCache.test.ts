import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIndexedDbWordsCache, createMemoryWordsCache } from './wordsCache'
import type { Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

afterEach(() => vi.unstubAllGlobals())

describe('createMemoryWordsCache', () => {
  it('reads null when empty', async () => {
    await expect(createMemoryWordsCache().read()).resolves.toBeNull()
  })
  it('hands back whatever it was seeded with, unvalidated -- validation is the caller\'s job', async () => {
    await expect(createMemoryWordsCache({ not: 'words' }).read()).resolves.toEqual({ not: 'words' })
  })
  it('write then read round-trips, and write reports success', async () => {
    const cache = createMemoryWordsCache()
    const words = [word('alpha'), word('beta')]
    await expect(cache.write(words)).resolves.toBe(true)
    await expect(cache.read()).resolves.toEqual(words)
  })
  it('clear leaves it empty', async () => {
    const cache = createMemoryWordsCache([word('alpha')])
    await cache.clear()
    await expect(cache.read()).resolves.toBeNull()
  })
})

// happy-dom has no indexedDB at all (checked: `'indexedDB' in new Window()`
// is false on 20.11.1), so the suite can only reach the fallback. The real
// IndexedDB path is exercised in a browser, not here.
describe('createIndexedDbWordsCache: fallback', () => {
  it('with no indexedDB global it behaves as the memory cache and never throws', async () => {
    expect(typeof indexedDB).toBe('undefined')   // the premise of this block; if happy-dom grows one, the tests below need a real double
    const cache = createIndexedDbWordsCache()
    await expect(cache.read()).resolves.toBeNull()
    const words = [word('alpha')]
    await expect(cache.write(words)).resolves.toBe(true)
    await expect(cache.read()).resolves.toEqual(words)    // proves the fallback engaged rather than silently dropping the write
    await cache.clear()
    await expect(cache.read()).resolves.toBeNull()
  })

  it('an open() that throws synchronously falls back the same way', async () => {
    vi.stubGlobal('indexedDB', { open() { throw new Error('SecurityError: private mode') } })
    const cache = createIndexedDbWordsCache()
    const words = [word('beta')]
    await expect(cache.write(words)).resolves.toBe(true)
    await expect(cache.read()).resolves.toEqual(words)
  })

  it('an open() that fails asynchronously (onerror) falls back too', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        const req: { onerror?: (e: unknown) => void } = {}
        setTimeout(() => req.onerror?.(new Error('blocked')), 0)
        return req
      },
    })
    const cache = createIndexedDbWordsCache()
    const words = [word('gamma')]
    await expect(cache.write(words)).resolves.toBe(true)
    await expect(cache.read()).resolves.toEqual(words)
  })

  it('each factory call is its own fallback store -- two caches do not share memory', async () => {
    const a = createIndexedDbWordsCache()
    const b = createIndexedDbWordsCache()
    await a.write([word('alpha')])
    await expect(b.read()).resolves.toBeNull()
  })
})
