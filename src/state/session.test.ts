import { beforeEach, describe, expect, it } from 'vitest'
import { bootSnapshot, cachedProgress, carryOverFor, pendingOps, setPendingOps } from './session'
import { applyWordOps, parseWords } from './sync'
import type { WordsOp } from './sync'
import { storage } from '../lib/storage'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

const entry = (lastReviewedAt: string): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
  stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt,
})

const dirtyProgress = (): Progress => {
  const p = emptyProgress()
  p.words['a'] = entry('2026-07-25T01:00:00Z')
  return p
}

beforeEach(() => localStorage.clear())

describe('待推送词库改动的持久化', () => {
  it('存取往返', () => {
    const ops: WordsOp[] = [{ kind: 'upsert', word: word('a') }, { kind: 'delete', ids: ['b'] }]
    setPendingOps(ops)
    expect(pendingOps()).toEqual(ops)
  })

  it('空队列不在 localStorage 里留键', () => {
    setPendingOps([{ kind: 'delete', ids: ['x'] }])
    setPendingOps([])
    expect(localStorage.getItem('volcab.wordOps')).toBeNull()
    expect(pendingOps()).toEqual([])
  })

  it('存坏了当没有,不把整个 App 带崩', () => {
    localStorage.setItem('volcab.wordOps', '{oops')
    expect(pendingOps()).toEqual([])
    storage.set('wordOps', [{ kind: 'nonsense' }])
    expect(pendingOps()).toEqual([])
  })

  it('丢弃队列里形状不对的条目,保留合法的', () => {
    storage.set('wordOps', [{ kind: 'delete', ids: ['b'] }, { kind: 'upsert', word: { id: 42 } }])
    expect(pendingOps()).toEqual([{ kind: 'delete', ids: ['b'] }])
  })

  // 这条盯的是最容易悄悄丢数据的一幕:改了词 → 推送失败 → 关掉页面 →
  // 下次启动 boot 拿远端覆盖本地缓存。队列不持久化的话,这里就是编辑的坟墓。
  it('进程重启后:队列重放到新拉回的远端副本上,本地编辑不丢、他端新增也保住', () => {
    setPendingOps([{ kind: 'upsert', word: word('zeta') }, { kind: 'delete', ids: ['beta'] }])

    // 关掉页面再打开:内存里的 ref 全没了,只剩 localStorage
    const freshRemote = JSON.stringify({
      version: 1,
      words: [word('alpha'), word('beta'), word('gamma')],   // 远端没有 zeta,他端新加了 gamma
    })
    const rebuilt = applyWordOps(parseWords(freshRemote), pendingOps())

    expect(rebuilt.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'zeta'])
  })
})

describe('carryOverFor:重新登录时哪些本地欠账能带过去', () => {
  it('同一个账号:未推送的进度和词库改动都带走', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', true)
    storage.set('progress', dirtyProgress())
    setPendingOps([{ kind: 'delete', ids: ['b'] }])

    const out = carryOverFor('alice')
    expect(out.progress?.words['a']).toBeDefined()
    expect(out.ops).toHaveLength(1)
    expect(out.discardedOwner).toBeNull()
  })

  it('同一个账号但没有欠账:什么都不带,以远端为准', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', false)
    storage.set('progress', dirtyProgress())

    const out = carryOverFor('alice')
    expect(out.progress).toBeNull()
    expect(out.ops).toEqual([])
    expect(out.discardedOwner).toBeNull()
  })

  it('换了账号:一律不跨账号合并,但要报出被丢弃的是谁', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', true)
    storage.set('progress', dirtyProgress())
    setPendingOps([{ kind: 'upsert', word: word('z') }])

    const out = carryOverFor('bob')
    expect(out.progress).toBeNull()
    expect(out.ops).toEqual([])
    expect(out.discardedOwner).toBe('alice')   // 静默丢弃是不行的
  })

  it('换了账号但上一位没有欠账:不必打扰用户', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', false)
    expect(carryOverFor('bob').discardedOwner).toBeNull()
  })

  it('演示模式留下的痕迹不算欠账', () => {
    storage.set('owner', 'demo')
    storage.set('progress', dirtyProgress())   // 演示模式不置 dirty
    expect(carryOverFor('alice').discardedOwner).toBeNull()
  })

  it('本机从没登录过:没有 owner 就没有跨账号问题', () => {
    expect(carryOverFor('alice')).toEqual({ progress: null, ops: [], discardedOwner: null })
  })
})

describe('bootSnapshot', () => {
  it('没有 token:停在登录页', () => {
    expect(bootSnapshot(false).phase).toBe('login')
  })

  it('token + 完整缓存:首帧就能用,不闪加载态', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    storage.set('words', [word('a')])
    storage.set('progress', emptyProgress())
    const s = bootSnapshot(false)
    expect(s.phase).toBe('ready')
    expect(s.owner).toBe('alice')
    expect(s.words).toHaveLength(1)
  })

  it('token 在但缓存缺失:先进 boot,等远端拉回来', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    expect(bootSnapshot(false).phase).toBe('boot')
  })

  it('缓存形状不对当作缺失,不把坏数据喂给页面', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    storage.set('words', [word('a')])
    storage.set('progress', { version: 1, words: {} })   // 缺 settings / dailyStats
    expect(bootSnapshot(false).phase).toBe('boot')
    expect(cachedProgress()).toBeNull()
  })

  it('开发演示模式:没有 token 也要进 boot 好自动恢复', () => {
    storage.set('owner', 'demo')
    expect(bootSnapshot(true).phase).toBe('boot')
    expect(bootSnapshot(false).phase).toBe('login')   // 生产构建里绝不认这条路
  })
})
