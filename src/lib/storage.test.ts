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
