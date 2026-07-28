import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendPendingStaging, bootSnapshot, cachedProgress, cachedStaging, carryOverFor,
  pendingOps, pendingStaging, setPendingOps, setPendingStaging,
} from './session'
import { applyWordOps, mergeStaging, parseStaging, parseWords } from './sync'
import type { WordsOp } from './sync'
import { storage } from '../lib/storage'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, StagingItem, Word } from '../types'

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

const item = (headword: string, addedAt = '2026-07-25'): StagingItem => ({ headword, addedAt })

const dirtyProgress = (): Progress => {
  const p = emptyProgress()
  p.words['a'] = entry('2026-07-25T01:00:00Z')
  return p
}

beforeEach(() => localStorage.clear())

describe('persistence of pending vocabulary changes', () => {
  it('round-trips through storage', () => {
    const ops: WordsOp[] = [{ kind: 'upsert', word: word('a') }, { kind: 'delete', ids: ['b'] }]
    setPendingOps(ops)
    expect(pendingOps()).toEqual(ops)
  })

  it('an empty queue leaves no key in localStorage', () => {
    setPendingOps([{ kind: 'delete', ids: ['x'] }])
    setPendingOps([])
    expect(localStorage.getItem('volcab.wordOps')).toBeNull()
    expect(pendingOps()).toEqual([])
  })

  it('treats corrupted storage as absent, without taking down the whole App', () => {
    localStorage.setItem('volcab.wordOps', '{oops')
    expect(pendingOps()).toEqual([])
    storage.set('wordOps', [{ kind: 'nonsense' }])
    expect(pendingOps()).toEqual([])
  })

  it('discards malformed entries in the queue, keeps the valid ones', () => {
    storage.set('wordOps', [{ kind: 'delete', ids: ['b'] }, { kind: 'upsert', word: { id: 42 } }])
    expect(pendingOps()).toEqual([{ kind: 'delete', ids: ['b'] }])
  })

  // This one watches the scenario most prone to silent data loss: edit a word -> push fails -> close the page ->
  // next boot overwrites the local cache with the remote. Without a persisted queue, this is where the edit dies.
  it('after a process restart: the queue replays onto the freshly re-pulled remote copy, local edits survive, and others\' additions are kept too', () => {
    setPendingOps([{ kind: 'upsert', word: word('zeta') }, { kind: 'delete', ids: ['beta'] }])

    // Close and reopen the page: everything in memory is gone, only localStorage remains
    const freshRemote = JSON.stringify({
      version: 1,
      words: [word('alpha'), word('beta'), word('gamma')],   // remote has no zeta; gamma was added elsewhere
    })
    const rebuilt = applyWordOps(parseWords(freshRemote), pendingOps())

    expect(rebuilt.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'zeta'])
  })
})

describe('persistence of pending staged words (staging)', () => {
  it('round-trips through storage; an empty queue leaves no key', () => {
    setPendingStaging([item('ostensible'), item('perfunctory')])
    expect(pendingStaging()).toEqual([item('ostensible'), item('perfunctory')])
    setPendingStaging([])
    expect(localStorage.getItem('volcab.stagingOps')).toBeNull()
    expect(pendingStaging()).toEqual([])
  })

  it('treats corrupted storage as absent, and discards malformed entries', () => {
    localStorage.setItem('volcab.stagingOps', '{oops')
    expect(pendingStaging()).toEqual([])
    storage.set('stagingOps', [item('ok'), { headword: 'no-date' }, { addedAt: '2026-07-25' }])
    expect(pendingStaging()).toEqual([item('ok')])
  })

  it('appending does not double-queue the same word (case/whitespace differences don\'t count as different)', () => {
    appendPendingStaging(item('Ad  Hoc'))
    appendPendingStaging(item(' ad hoc '))
    expect(pendingStaging()).toHaveLength(1)
  })

  it('treats a malformed cache as absent, without feeding bad data to the page', () => {
    storage.set('staging', [{ headword: 'x' }])
    expect(cachedStaging()).toBeNull()
    storage.set('staging', [item('ostensible')])
    expect(cachedStaging()).toEqual([item('ostensible')])
  })

  // Stage a word offline -> close the page -> reopen once back online. Without a persisted queue, this is where
  // those words die; and the merge must be a union, not local overwriting whatever was staged elsewhere meanwhile.
  it('words staged offline survive a process restart and union-merge with the remote once back online', () => {
    appendPendingStaging(item('ostensible', '2026-07-25'))
    appendPendingStaging(item('perfunctory', '2026-07-25'))

    // Reopen: everything in memory is gone, only localStorage remains; meanwhile gamma was staged elsewhere, and so was ostensible
    const remote = JSON.stringify({
      version: 1,
      items: [item('gamma', '2026-07-01'), item('Ostensible', '2026-07-20')],
    })
    const rebuilt = mergeStaging(parseStaging(remote), pendingStaging())

    expect(rebuilt.map(i => i.headword.toLowerCase()).sort())
      .toEqual(['gamma', 'ostensible', 'perfunctory'])
    // Two records of the same word merge into one, keeping the earlier date
    expect(rebuilt.find(i => i.headword.toLowerCase() === 'ostensible')?.addedAt).toBe('2026-07-20')
  })
})

describe('carryOverFor: which local debt can be carried over on re-login', () => {
  it('same account: unpushed progress and vocabulary changes are both carried over', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', true)
    storage.set('progress', dirtyProgress())
    setPendingOps([{ kind: 'delete', ids: ['b'] }])
    setPendingStaging([item('ostensible')])

    const out = carryOverFor('alice')
    expect(out.progress?.words['a']).toBeDefined()
    expect(out.ops).toHaveLength(1)
    expect(out.staging).toEqual([item('ostensible')])
    expect(out.discardedOwner).toBeNull()
  })

  it('account switch: unpushed staged words are discarded too, must not end up mixed into someone else\'s staging area', () => {
    storage.set('owner', 'alice')
    setPendingStaging([item('ostensible')])

    const out = carryOverFor('bob')
    expect(out.staging).toEqual([])
    expect(out.discardedOwner).toBe('alice')   // even debt consisting only of staged words must be reported, never silently
  })

  it('same account but no debt: nothing is carried over, remote wins', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', false)
    storage.set('progress', dirtyProgress())

    const out = carryOverFor('alice')
    expect(out.progress).toBeNull()
    expect(out.ops).toEqual([])
    expect(out.discardedOwner).toBeNull()
  })

  it('account switch: never merges across accounts, but must report who got discarded', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', true)
    storage.set('progress', dirtyProgress())
    setPendingOps([{ kind: 'upsert', word: word('z') }])

    const out = carryOverFor('bob')
    expect(out.progress).toBeNull()
    expect(out.ops).toEqual([])
    expect(out.discardedOwner).toBe('alice')   // silent discarding is not acceptable
  })

  it('account switch but the previous owner had no debt: no need to bother the user', () => {
    storage.set('owner', 'alice')
    storage.set('dirty', false)
    expect(carryOverFor('bob').discardedOwner).toBeNull()
  })

  it('traces left behind by demo mode do not count as debt', () => {
    storage.set('owner', 'demo')
    storage.set('progress', dirtyProgress())   // demo mode never sets dirty
    expect(carryOverFor('alice').discardedOwner).toBeNull()
  })

  it('this device has never logged in before: no owner means no cross-account question', () => {
    expect(carryOverFor('alice')).toEqual({ progress: null, ops: [], staging: [], discardedOwner: null })
  })
})

describe('bootSnapshot', () => {
  it('no token: stays on the login page', () => {
    expect(bootSnapshot(false).phase).toBe('login')
  })

  it('token + complete cache: usable on the first frame, no flash of a loading state', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    storage.set('words', [word('a')])
    storage.set('progress', emptyProgress())
    storage.set('staging', [item('ostensible')])
    const s = bootSnapshot(false)
    expect(s.phase).toBe('ready')
    expect(s.owner).toBe('alice')
    expect(s.words).toHaveLength(1)
    expect(s.staging).toEqual([item('ostensible')])
  })

  // The third file gets no veto power: whether it's corrupted or missing, both just mean "the staging area is empty"
  it('a missing or corrupted staging cache never blocks reaching ready -- it\'s the least important of the three files', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    storage.set('words', [word('a')])
    storage.set('progress', emptyProgress())
    expect(bootSnapshot(false)).toMatchObject({ phase: 'ready', staging: [] })

    localStorage.setItem('volcab.staging', '{oops')
    expect(bootSnapshot(false)).toMatchObject({ phase: 'ready', staging: [] })
  })

  it('token present but cache missing: goes to boot first, waits for the remote fetch', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    expect(bootSnapshot(false).phase).toBe('boot')
  })

  it('a malformed cache is treated as missing, without feeding bad data to the page', () => {
    storage.set('token', 't'); storage.set('owner', 'alice')
    storage.set('words', [word('a')])
    storage.set('progress', { version: 1, words: {} })   // missing settings / dailyStats
    expect(bootSnapshot(false).phase).toBe('boot')
    expect(cachedProgress()).toBeNull()
  })

  it('dev demo mode: goes to boot even without a token, so it can auto-recover', () => {
    storage.set('owner', 'demo')
    expect(bootSnapshot(true).phase).toBe('boot')
    expect(bootSnapshot(false).phase).toBe('login')   // production builds never recognize this path
  })
})
