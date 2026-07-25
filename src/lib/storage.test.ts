import { beforeEach, describe, expect, it } from 'vitest'
import { storage } from './storage'

beforeEach(() => localStorage.clear())

describe('storage', () => {
  it('set/get JSON roundtrip', () => {
    storage.set('progress', { version: 1 })
    expect(storage.get('progress')).toEqual({ version: 1 })
  })
  it('不存在返回 null', () => expect(storage.get('token')).toBeNull())
  it('损坏的 JSON 返回 null 而不抛错', () => {
    localStorage.setItem('volcab.progress', '{oops')
    expect(storage.get('progress')).toBeNull()
  })
  it('clearAll 清空全部本键', () => {
    storage.set('token', 't'); storage.set('owner', 'o')
    storage.clearAll()
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBeNull()
  })
})
