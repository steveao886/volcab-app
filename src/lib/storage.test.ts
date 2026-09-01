import { beforeEach, describe, expect, it } from 'vitest'
import { storage } from './storage'

beforeEach(() => localStorage.clear())

describe('storage', () => {
  it('set/get JSON roundtrip', () => {
    storage.set('progress', { version: 1 })
    expect(storage.get('progress')).toEqual({ version: 1 })
  })
  it('returns null when it does not exist', () => expect(storage.get('token')).toBeNull())
  it('returns null for corrupted JSON instead of throwing', () => {
    localStorage.setItem('volcab.progress', '{oops')
    expect(storage.get('progress')).toBeNull()
  })
  it('clearAll clears all of this app\'s keys', () => {
    storage.set('token', 't'); storage.set('owner', 'o')
    storage.clearAll()
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBeNull()
  })
})

// The old `void` signature let a QuotaExceededError escape from inside a
// click handler: commitProgress wrote storage before setState, so at the
// quota every grade was thrown away before React ever saw it. Measured
// 2026-09-01: the words + progress caches sit at 977,624 UTF-16 code units,
// about 37% of WebKit's 5 MiB, growing ~1,400 per word.
describe('storage.set never throws', () => {
  it('returns true on a normal write', () => {
    expect(storage.set('dirty', true)).toBe(true)
  })
  it('returns false and swallows a QuotaExceededError from setItem', () => {
    // Patched with defineProperty on the instance, not on Storage.prototype:
    // happy-dom's Storage is a Proxy that binds each method onto the target
    // as an own property on first access and caches it, so a prototype patch
    // made after any earlier test wrote through it is never seen -- and a
    // plain `localStorage.setItem = fn` is swallowed by the proxy's set trap.
    const original = localStorage.setItem
    const refuse = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
    Object.defineProperty(localStorage, 'setItem', { value: refuse, configurable: true, writable: true })
    try {
      expect(storage.set('progress', { big: true })).toBe(false)
    } finally {
      Object.defineProperty(localStorage, 'setItem', { value: original, configurable: true, writable: true })
    }
    expect(storage.set('progress', { small: true })).toBe(true)   // the patch really was undone
  })
})
