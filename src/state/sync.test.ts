import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyWordOps, loadStaging, mergeStaging, normalizeHeadword, parseProgress, parseStaging,
  parseWords, pushProgress, pushStaging, pushWords,
  reconcileProgress, reconcileStaging, reconcileWords, serializeStaging,
} from './sync'
import type { SyncClient, WordsOp } from './sync'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, StagingItem, Word } from '../types'
import { storage } from '../lib/storage'
import realLibrary from '../../data/words.json'

// --- Test doubles ------------------------------------------------------------
// Plain-object fake client: no HTTP, no module mocking; returns putFile results in script order.

type PutResult = { sha: string } | 'conflict' | Error
interface PutCall { path: string; content: string; message: string; sha?: string }

function fakeClient(script: {
  puts: PutResult[]
  files?: Record<string, { content: string; sha: string }>
  getThrows?: Error
}) {
  const putCalls: PutCall[] = []
  const getCalls: string[] = []
  let i = 0
  const client: SyncClient = {
    async getFile(path) {
      getCalls.push(path)
      if (script.getThrows) throw script.getThrows
      return script.files?.[path] ?? null
    },
    async putFile(path, content, message, sha) {
      putCalls.push({ path, content, message, sha })
      const r = script.puts[i++]
      if (r === undefined) throw new Error(`ran past the script: putFile call #${i} has no expected result`)
      if (r instanceof Error) throw r
      return r
    },
  }
  return { client, putCalls, getCalls }
}

const entry = (lastReviewedAt: string, reps: number): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
  stepIndex: 0, reps, lapses: 0, lastReviewedAt,
})

const word = (id: string): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

const wordsFile = (ids: string[]) => JSON.stringify({ version: 1, words: ids.map(word) })
const lastPut = (calls: PutCall[]) => calls[calls.length - 1]

const item = (headword: string, addedAt = '2026-07-25'): StagingItem => ({ headword, addedAt })
const stagingFile = (items: StagingItem[]) => JSON.stringify({ version: 1, items })
const sentStaging = (calls: PutCall[]) => (JSON.parse(lastPut(calls).content) as { items: StagingItem[] }).items

beforeEach(() => {
  localStorage.clear()
})

// --- progress push ------------------------------------------------------------

describe('pushProgress', () => {
  it('success: pushes with the local sha, writes back the new sha, and clears dirty', async () => {
    storage.set('progressSha', 'sha-old')
    storage.set('dirty', true)
    const local = emptyProgress()
    local.words['a'] = entry('2026-07-25T01:00:00Z', 1)

    const { client, putCalls, getCalls } = fakeClient({ puts: [{ sha: 'sha-new' }] })
    const out = await pushProgress(client, local)

    expect(out).toEqual({ ok: true, sha: 'sha-new', data: local })
    expect(putCalls).toHaveLength(1)
    expect(getCalls).toHaveLength(0)
    expect(putCalls[0].path).toBe('progress.json')
    expect(putCalls[0].sha).toBe('sha-old')
    expect(JSON.parse(putCalls[0].content).words['a'].reps).toBe(1)
    expect(storage.get('progressSha')).toBe('sha-new')
    expect(storage.get('dirty')).toBe(false)
  })

  it('first push (no local sha yet): sends without a sha', async () => {
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'sha-1' }] })
    await pushProgress(client, emptyProgress())
    expect(putCalls[0].sha).toBeUndefined()
  })

  it('conflict: re-pulls the remote, merges, pushes again, and keeps both sides\' records', async () => {
    storage.set('progressSha', 'sha-stale')
    const local = emptyProgress()
    local.words['a'] = entry('2026-07-25T01:00:00Z', 5)
    local.dailyStats['2026-07-25'] = { reviewed: 4, newLearned: 1, correct: 3, quizTaken: 0 }

    const remote = emptyProgress()
    remote.words['a'] = entry('2026-07-24T01:00:00Z', 4)  // older, should be overridden by local
    remote.words['b'] = entry('2026-07-25T02:00:00Z', 9)  // exists only on the remote, must be preserved
    remote.dailyStats['2026-07-25'] = { reviewed: 2, newLearned: 0, correct: 2, quizTaken: 1 }

    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', { sha: 'sha-merged' }],
      files: { 'progress.json': { content: JSON.stringify(remote), sha: 'sha-remote' } },
    })
    const out = await pushProgress(client, local)

    expect(out.ok).toBe(true)
    expect(getCalls).toEqual(['progress.json'])
    expect(putCalls).toHaveLength(2)
    expect(putCalls[1].sha).toBe('sha-remote')   // re-pushes with the remote's latest sha

    const sent = JSON.parse(lastPut(putCalls).content) as Progress
    expect(sent.words['a'].reps).toBe(5)         // local is newer, wins
    expect(sent.words['b'].reps).toBe(9)         // the other device's review record wasn't swallowed
    expect(sent.dailyStats['2026-07-25'].quizTaken).toBe(1)
    expect(sent.dailyStats['2026-07-25'].reviewed).toBe(4)

    if (out.ok) expect(out.data.words['b'].reps).toBe(9)  // the merged result is handed back to the caller
    expect(storage.get('progressSha')).toBe('sha-merged')
    expect(storage.get('dirty')).toBe(false)
  })

  it('two conflicts in a row: retries exactly once then gives up, sets an error and keeps dirty', async () => {
    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', 'conflict'],
      files: { 'progress.json': { content: JSON.stringify(emptyProgress()), sha: 'sha-remote' } },
    })
    const out = await pushProgress(client, emptyProgress())

    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(2)   // exactly one retry, doesn't continue further
    expect(getCalls).toHaveLength(1)
    expect(storage.get('dirty')).toBe(true)
  })

  it('network error: no retry, marks dirty for next time, local data untouched', async () => {
    storage.set('progressSha', 'sha-old')
    const local = emptyProgress()
    local.words['a'] = entry('2026-07-25T01:00:00Z', 5)
    const snapshot = structuredClone(local)

    const { client, putCalls, getCalls } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    const out = await pushProgress(client, local)

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('Failed to fetch')
    expect(putCalls).toHaveLength(1)
    expect(getCalls).toHaveLength(0)
    expect(local).toEqual(snapshot)
    expect(storage.get('progressSha')).toBe('sha-old')  // sha untouched
    expect(storage.get('dirty')).toBe(true)
  })

  it('remote progress.json fails to parse: refuses to overwrite, doesn\'t send a second put', async () => {
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'never' }],
      files: { 'progress.json': { content: '{"version":1,"words":', sha: 'sha-remote' } },
    })
    const out = await pushProgress(client, emptyProgress())

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('备份')
    expect(putCalls).toHaveLength(1)   // the second put never happens
    expect(storage.get('dirty')).toBe(true)
  })

  it('local changed again while the push was in flight: success still doesn\'t clear dirty', async () => {
    storage.set('dirty', true)
    let resolvePut: (r: { sha: string }) => void = () => {}
    const client: SyncClient = {
      async getFile() { return null },
      putFile: () => new Promise(res => { resolvePut = res }),
    }
    const pending = pushProgress(client, emptyProgress())
    storage.set('dirty', true)          // the user graded another word while the request was in flight
    resolvePut({ sha: 'sha-new' })
    await pending

    expect(storage.get('dirty')).toBe(true)
  })
})

// --- words push ----------------------------------------------------------------

describe('pushWords', () => {
  it('success: overwrites the whole vocabulary, writes back wordsSha', async () => {
    storage.set('wordsSha', 'w-old')
    const local = [word('alpha'), word('beta')]
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'w-new' }] })

    const out = await pushWords(client, local, [{ kind: 'upsert', word: word('beta') }])

    expect(out).toEqual({ ok: true, sha: 'w-new', data: local })
    expect(putCalls[0].path).toBe('words.json')
    expect(putCalls[0].sha).toBe('w-old')
    expect(JSON.parse(putCalls[0].content).version).toBe(1)
    expect(storage.get('wordsSha')).toBe('w-new')
  })

  it('conflict: replays this session\'s addition onto the freshly re-pulled remote copy, keeping all other entries', async () => {
    const mine = word('zeta')
    const local = [word('alpha'), mine]                       // local view: behind by one, gamma
    const remoteIds = ['alpha', 'gamma']                       // gamma was added elsewhere concurrently

    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', { sha: 'w-merged' }],
      files: { 'words.json': { content: wordsFile(remoteIds), sha: 'w-remote' } },
    })
    const out = await pushWords(client, local, [{ kind: 'upsert', word: mine }])

    expect(out.ok).toBe(true)
    expect(getCalls).toEqual(['words.json'])
    expect(putCalls).toHaveLength(2)
    expect(putCalls[1].sha).toBe('w-remote')

    const sent = JSON.parse(lastPut(putCalls).content) as { words: Word[] }
    expect(sent.words.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'zeta'])
    if (out.ok) expect(out.data.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'zeta'])
  })

  it('conflict: replays this session\'s deletion, only wiping what was meant to be deleted, other additions remain', async () => {
    const local = [word('alpha')]                              // local just deleted beta
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'w-merged' }],
      files: { 'words.json': { content: wordsFile(['alpha', 'beta', 'gamma']), sha: 'w-remote' } },
    })

    const out = await pushWords(client, local, [{ kind: 'delete', ids: ['beta'] }])

    expect(out.ok).toBe(true)
    const sent = JSON.parse(lastPut(putCalls).content) as { words: Word[] }
    expect(sent.words.map(w => w.id).sort()).toEqual(['alpha', 'gamma'])
  })

  it('two conflicts in a row: gives up after one retry', async () => {
    const { client, putCalls } = fakeClient({
      puts: ['conflict', 'conflict'],
      files: { 'words.json': { content: wordsFile(['alpha']), sha: 'w-remote' } },
    })
    const out = await pushWords(client, [word('alpha')], [])
    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(2)
  })

  it('remote words.json fails to parse: refuses to overwrite', async () => {
    storage.set('wordsSha', 'w-old')
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'never' }],
      files: { 'words.json': { content: '[]', sha: 'w-remote' } },
    })
    const out = await pushWords(client, [word('alpha')], [])

    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(1)
    expect(storage.get('wordsSha')).toBe('w-old')
  })

  it('network error: reports the error, sha untouched', async () => {
    storage.set('wordsSha', 'w-old')
    const { client } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    const out = await pushWords(client, [word('alpha')], [])
    expect(out.ok).toBe(false)
    expect(storage.get('wordsSha')).toBe('w-old')
  })
})

describe('writing back after the session has already ended', () => {
  it('a push that only returns after logout no longer writes back any bookkeeping', async () => {
    storage.set('progressSha', 'sha-old')
    const { client } = fakeClient({ puts: [{ sha: 'sha-new' }] })
    const out = await pushProgress(client, emptyProgress(), { alive: () => false })

    expect(out.ok).toBe(true)          // the request itself succeeded
    expect(storage.get('progressSha')).toBe('sha-old')   // but this device already belongs to someone else now, so it leaves no trace
  })

  it('a push that fails after logout also doesn\'t write dirty back', async () => {
    const { client } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    await pushProgress(client, emptyProgress(), { alive: () => false })
    expect(storage.get('dirty')).toBeNull()
  })
})

// --- Reconciling a push's return against "local state right now" -----------
// This is the only mechanism preventing "graded another word while the push
// was in flight" from being swallowed, pulled out on its own to guarantee it
// never gets deleted as if it were redundant with sync's internal merging.

describe('reconcileProgress', () => {
  it('local hasn\'t changed since the push started: returned as-is, no new object', () => {
    const current = emptyProgress()
    expect(reconcileProgress(current, current)).toBe(current)
  })

  it('graded another word while the push was in flight: that grade must survive, alongside whatever the remote merge brought in', () => {
    // snapshot from when the push started + the other device's remote record, merged and handed back by pushProgress
    const pushed = emptyProgress()
    pushed.words['a'] = entry('2026-07-25T01:00:00Z', 1)
    pushed.words['remote-only'] = entry('2026-07-25T00:30:00Z', 7)
    pushed.dailyStats['2026-07-25'] = { reviewed: 1, newLearned: 1, correct: 1, quizTaken: 0 }

    // while the request was still in flight, the user reviewed a and b again
    const current = emptyProgress()
    current.words['a'] = entry('2026-07-25T02:00:00Z', 2)
    current.words['b'] = entry('2026-07-25T02:00:01Z', 1)
    current.dailyStats['2026-07-25'] = { reviewed: 3, newLearned: 2, correct: 3, quizTaken: 0 }

    const out = reconcileProgress(current, pushed)
    expect(out.words['a'].reps).toBe(2)              // the in-flight grade wasn't overwritten by the stale snapshot
    expect(out.words['b']).toBeDefined()
    expect(out.words['remote-only'].reps).toBe(7)    // what the remote merge brought in is still there too
    expect(out.dailyStats['2026-07-25'].reviewed).toBe(3)
  })
})

describe('reconcileWords', () => {
  it('local hasn\'t changed since the push started: returned as-is', () => {
    const current = [word('a')]
    expect(reconcileWords(current, current, [])).toBe(current)
  })

  it('a word added while the push was in flight must be reapplied onto the "remote + replay" result', () => {
    // result after conflict replay: gamma added concurrently on the remote + zeta from this push
    const pushed = [word('alpha'), word('gamma'), word('zeta')]
    // while the push was still in flight the user also added later, which isn't part of this push
    const remaining: WordsOp[] = [{ kind: 'upsert', word: word('later') }]

    const out = reconcileWords([word('alpha'), word('zeta'), word('later')], pushed, remaining)
    expect(out.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'later', 'zeta'])
  })

  it('a deletion made while the push was in flight must be reapplied too', () => {
    const pushed = [word('alpha'), word('gamma')]
    const out = reconcileWords([word('alpha')], pushed, [{ kind: 'delete', ids: ['gamma'] }])
    expect(out.map(w => w.id)).toEqual(['alpha'])
  })
})

// --- Pure functions ----------------------------------------------------------

describe('applyWordOps', () => {
  it('upsert overwrites on matching id, appends on a different id, order is stable', () => {
    const base = [word('a'), word('b')]
    const edited: Word = { ...word('b'), headword: 'B!' }
    const ops: WordsOp[] = [{ kind: 'upsert', word: edited }, { kind: 'upsert', word: word('c') }]
    const out = applyWordOps(base, ops)
    expect(out.map(w => w.id)).toEqual(['a', 'b', 'c'])
    expect(out[1].headword).toBe('B!')
    expect(base.map(w => w.headword)).toEqual(['a', 'b'])  // input is not mutated
  })

  it('delete removes multiple ids, a nonexistent id is a no-op', () => {
    const out = applyWordOps([word('a'), word('b'), word('c')], [{ kind: 'delete', ids: ['b', 'zzz'] }])
    expect(out.map(w => w.id)).toEqual(['a', 'c'])
  })
})

describe('parse guards', () => {
  it('parseProgress accepts a valid file', () => {
    const p = emptyProgress()
    p.settings.newPerDay = 20
    expect(parseProgress(JSON.stringify(p)).settings.newPerDay).toBe(20)
  })
  it.each([
    ['non-JSON', '{oops'],
    ['wrong version', '{"version":2,"settings":{"newPerDay":10},"words":{},"dailyStats":{}}'],
    ['missing fields', '{"version":1,"words":{}}'],
    ['is an array', '[]'],
  ])('parseProgress rejects %s', (_label, text) => {
    expect(() => parseProgress(text)).toThrow()
  })

  it.each([
    ['progress entry missing fields', '{"version":1,"settings":{"newPerDay":10},"words":{"a":{"state":"review"}},"dailyStats":{}}'],
    ['progress entry has an invalid state', `{"version":1,"settings":{"newPerDay":10},"words":{"a":${JSON.stringify({ ...entry('t', 1), state: 'bogus' })}},"dailyStats":{}}`],
    ['daily stat missing fields', '{"version":1,"settings":{"newPerDay":10},"words":{},"dailyStats":{"2026-07-25":{"reviewed":1}}}'],
    ['daily stat field is not a number', '{"version":1,"settings":{"newPerDay":10},"words":{},"dailyStats":{"2026-07-25":{"reviewed":"1","newLearned":0,"correct":0,"quizTaken":0}}}'],
  ])('parseProgress rejects %s -- a half-broken file would blow up on the page, so it can\'t be let through', (_label, text) => {
    expect(() => parseProgress(text)).toThrow()
  })

  it('parseWords accepts a valid file', () => {
    expect(parseWords(wordsFile(['a', 'b'])).map(w => w.id)).toEqual(['a', 'b'])
  })
  it.each([
    ['non-JSON', '{oops'],
    ['top level is an array', '[]'],
    ['words is not an array', '{"version":1,"words":{}}'],
    ['entry missing id', '{"version":1,"words":[{"headword":"x"}]}'],
    ['entry missing meanings', `{"version":1,"words":[${JSON.stringify({ ...word('a'), meanings: undefined })}]}`],
    ['meanings is an empty array', `{"version":1,"words":[${JSON.stringify({ ...word('a'), meanings: [] })}]}`],
    ['meanings entry missing zh', '{"version":1,"words":[{"id":"a","headword":"a","phonetic":"/a/","meanings":[{"pos":"n.","en":"a"}],"examples":[],"synonyms":[],"antonyms":[],"collocations":[],"relatedForms":[],"sourceNote":"m","addedAt":"2026-07-25"}]}'],
    ['examples is not an array', `{"version":1,"words":[${JSON.stringify({ ...word('a'), examples: 'nope' })}]}`],
    ['relatedForms missing', `{"version":1,"words":[${JSON.stringify({ ...word('a'), relatedForms: undefined })}]}`],
  ])('parseWords rejects %s', (_label, text) => {
    expect(() => parseWords(text)).toThrow()
  })

  // The contents of this file go into volcab-data, so it must pass our own validation.
  //
  // **This asserts "not a single one got dropped by the parser", not any specific word count.** This used to hard-code
  // 476, and then the vocabulary changed (5 words removed upstream, the repo copy aligned to match) and the test went
  // red even though parsing itself had no problem -- that kind of assertion only restates the vocabulary's current
  // size, it doesn't test any behavior.
  // The second assertion used to name one word (`interchangeability`) as a
  // canary for "the parser kept the entries, not just the count". That word
  // was then deleted in-app, and the test went red for the same reason the
  // comment above describes -- an assertion that restates today's vocabulary
  // instead of testing behavior. Comparing the id lists says the stronger
  // thing (nothing dropped, nothing reordered, every id survived the parse)
  // and never needs editing when the library changes.
  it('the vocabulary in this repo can be fully parsed by parseWords', () => {
    const parsed = parseWords(JSON.stringify(realLibrary))
    expect(parsed).toHaveLength(realLibrary.words.length)
    expect(parsed.map(w => w.id)).toEqual(realLibrary.words.map(w => w.id))
  })
})

// === New-word staging area staging.json =====================================
// The third sync file. Its rules are much simpler than progress's: union by
// normalized headword, keeping the earlier addedAt for the same word.
// Mostly append, naturally idempotent -- but it's the newest piece bolted
// on, so every case below is watching for "don't drag the existing two
// files down with it".

describe('normalizeHeadword', () => {
  it('case, leading/trailing whitespace, and internal whitespace runs all normalize to the same key', () => {
    expect(normalizeHeadword('  Ostensible ')).toBe('ostensible')
    expect(normalizeHeadword('Ad   Hoc')).toBe('ad hoc')
    expect(normalizeHeadword('ad hoc')).toBe(normalizeHeadword(' AD  HOC '))
  })
})

describe('mergeStaging', () => {
  it('takes the union: words added on either side are both kept', () => {
    const out = mergeStaging([item('ostensible')], [item('perfunctory')])
    expect(out.map(i => i.headword)).toEqual(['ostensible', 'perfunctory'])
  })

  it('two devices added the same word: merges into one entry, keeping the earlier addedAt', () => {
    const a = [item('ostensible', '2026-07-25')]
    const b = [item('ostensible', '2026-07-20')]
    expect(mergeStaging(a, b)).toEqual([item('ostensible', '2026-07-20')])
    // merging in the reverse order gives the same result -- which side goes first must not affect the content, or two devices would keep overriding each other
    expect(mergeStaging(b, a)).toEqual([item('ostensible', '2026-07-20')])
  })

  it('case and whitespace differences count as the same word, not queued twice', () => {
    const out = mergeStaging([item('Ad  Hoc', '2026-07-25')], [item(' ad hoc ', '2026-07-26')])
    expect(out).toHaveLength(1)
    expect(normalizeHeadword(out[0].headword)).toBe('ad hoc')
  })

  it('idempotent: merging the same content any number of times doesn\'t change it', () => {
    const base = [item('a', '2026-07-01'), item('b', '2026-07-02')]
    expect(mergeStaging(mergeStaging(base, base), base)).toEqual(base)
  })

  it('doesn\'t mutate its inputs, and drops blank headwords', () => {
    const a = [item('ostensible')]
    const out = mergeStaging(a, [item('   ')])
    expect(out).toEqual([item('ostensible')])
    expect(a).toEqual([item('ostensible')])
  })
})

describe('parseStaging / serializeStaging', () => {
  it('accepts a valid file', () => {
    expect(parseStaging(stagingFile([item('ostensible')]))).toEqual([item('ostensible')])
  })

  it('an empty list is valid -- the completion flow moves every entry out eventually', () => {
    expect(parseStaging('{"version":1,"items":[]}')).toEqual([])
  })

  it('serializes with 2-space indent + trailing newline, consistent with the other two files', () => {
    const text = serializeStaging([item('ostensible')])
    expect(text).toBe('{\n  "version": 1,\n  "items": [\n    {\n      "headword": "ostensible",\n      "addedAt": "2026-07-25"\n    }\n  ]\n}\n')
    expect(parseStaging(text)).toEqual([item('ostensible')])
  })

  it.each([
    ['non-JSON', '{oops'],
    ['top level is an array', '[]'],
    ['wrong version', '{"version":2,"items":[]}'],
    ['items is not an array', '{"version":1,"items":{}}'],
    ['entry missing addedAt', '{"version":1,"items":[{"headword":"ostensible"}]}'],
    ['addedAt is not a date', '{"version":1,"items":[{"headword":"ostensible","addedAt":"昨天"}]}'],
    ['headword is a blank string', '{"version":1,"items":[{"headword":"  ","addedAt":"2026-07-25"}]}'],
    ['headword is not a string', '{"version":1,"items":[{"headword":42,"addedAt":"2026-07-25"}]}'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseStaging(text)).toThrow()
  })
})

describe('loadStaging: the least important of the three files, treats an unreadable result as absent across the board', () => {
  it('remote doesn\'t have this file yet: returns null, doesn\'t throw', async () => {
    const { client } = fakeClient({ puts: [] })
    await expect(loadStaging(client)).resolves.toBeNull()
  })

  it('remote file is corrupted: returns null instead of letting the exception bubble up to the login/boot path', async () => {
    const { client } = fakeClient({
      puts: [], files: { 'staging.json': { content: '{"version":1,"items":[{"nope":1}]}', sha: 's' } },
    })
    await expect(loadStaging(client)).resolves.toBeNull()
  })

  it('the read itself fails (network/permissions): swallowed the same way -- it must never be the reason a login fails or progress stops syncing', async () => {
    const { client } = fakeClient({ puts: [], getThrows: new Error('读取 staging.json 失败 (HTTP 500)') })
    await expect(loadStaging(client)).resolves.toBeNull()
  })

  // This one watches the easiest mistake to make when wiring in the third
  // file: dropping it into boot's Promise.all, where one rejection drags
  // words / progress down into the catch with it -- the user would see
  // "login failed" or an App that no longer syncs progress, when the real
  // cause is just a handful of not-yet-completed words.
  it('dropped into boot\'s Promise.all, it still doesn\'t drag words/progress down with it', async () => {
    const client: SyncClient = {
      async getFile(path) {
        if (path === 'staging.json') throw new Error('读取 staging.json 失败 (HTTP 500)')
        return { content: path === 'words.json' ? wordsFile(['alpha']) : JSON.stringify(emptyProgress()), sha: path }
      },
      async putFile() { throw new Error('this test case should not push') },
    }

    const [wf, pf, sf] = await Promise.all([
      client.getFile('words.json'), client.getFile('progress.json'), loadStaging(client),
    ])

    expect(parseWords(wf!.content)).toHaveLength(1)   // vocabulary comes through as normal
    expect(parseProgress(pf!.content).version).toBe(1) // progress comes through as normal
    expect(sf).toBeNull()                              // staging is treated as absent, and that's all
  })

  it('reads successfully: returns the entries and sha', async () => {
    const { client } = fakeClient({
      puts: [], files: { 'staging.json': { content: stagingFile([item('ostensible')]), sha: 'st-1' } },
    })
    await expect(loadStaging(client)).resolves.toEqual({ items: [item('ostensible')], sha: 'st-1' })
  })
})

describe('pushStaging', () => {
  it('success: overwrites the whole staging.json, writes back stagingSha', async () => {
    storage.set('stagingSha', 'st-old')
    const local = [item('ostensible')]
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'st-new' }] })

    const out = await pushStaging(client, local, local)

    expect(out).toEqual({ ok: true, sha: 'st-new', data: local })
    expect(putCalls[0].path).toBe('staging.json')
    expect(putCalls[0].sha).toBe('st-old')
    expect(JSON.parse(putCalls[0].content).version).toBe(1)
    expect(storage.get('stagingSha')).toBe('st-new')
  })

  it('first push (remote doesn\'t have this file yet): sends without a sha, creates it directly', async () => {
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'st-1' }] })
    await pushStaging(client, [item('ostensible')], [item('ostensible')])
    expect(putCalls[0].sha).toBeUndefined()
  })

  it('conflict: merges this session\'s staged words onto the freshly re-pulled remote copy, keeping every word staged elsewhere', async () => {
    const mine = item('zeta', '2026-07-25')
    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', { sha: 'st-merged' }],
      files: {
        'staging.json': {
          content: stagingFile([item('alpha', '2026-07-01'), item('gamma', '2026-07-02')]),
          sha: 'st-remote',
        },
      },
    })
    const out = await pushStaging(client, [mine], [mine])

    expect(out.ok).toBe(true)
    expect(getCalls).toEqual(['staging.json'])
    expect(putCalls[1].sha).toBe('st-remote')
    expect(sentStaging(putCalls).map(i => i.headword).sort()).toEqual(['alpha', 'gamma', 'zeta'])
    if (out.ok) expect(out.data.map(i => i.headword).sort()).toEqual(['alpha', 'gamma', 'zeta'])
  })

  it('conflict: both sides staged the same word on the same day, merge leaves one entry with the earlier date', async () => {
    const mine = item('Ostensible', '2026-07-25')
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'st-merged' }],
      files: { 'staging.json': { content: stagingFile([item('ostensible', '2026-07-20')]), sha: 'st-r' } },
    })
    const out = await pushStaging(client, [mine], [mine])

    expect(out.ok).toBe(true)
    expect(sentStaging(putCalls)).toEqual([item('ostensible', '2026-07-20')])
  })

  it('remote staging.json fails to parse: refuses to overwrite, doesn\'t send a second put, sha untouched', async () => {
    storage.set('stagingSha', 'st-old')
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'never' }],
      files: { 'staging.json': { content: '{"version":1,"items":[{"headword":"x"}]}', sha: 'st-r' } },
    })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')])

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('备份')
    expect(putCalls).toHaveLength(1)               // didn't overwrite the remote with the local copy
    expect(storage.get('stagingSha')).toBe('st-old')
  })

  it('two conflicts in a row: gives up after one retry, local entries stay put for the next push', async () => {
    const { client, putCalls } = fakeClient({
      puts: ['conflict', 'conflict'],
      files: { 'staging.json': { content: stagingFile([item('alpha')]), sha: 'st-r' } },
    })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')])
    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(2)
  })

  it('network error: reports the error, sha untouched', async () => {
    storage.set('stagingSha', 'st-old')
    const { client } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')])
    expect(out.ok).toBe(false)
    expect(storage.get('stagingSha')).toBe('st-old')
  })

  it('a push that only returns after logout doesn\'t write back stagingSha', async () => {
    storage.set('stagingSha', 'st-old')
    const { client } = fakeClient({ puts: [{ sha: 'st-new' }] })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')], { alive: () => false })
    expect(out.ok).toBe(true)
    expect(storage.get('stagingSha')).toBe('st-old')
  })
})

describe('reconcileStaging', () => {
  it('local hasn\'t changed since the push started: returned as-is', () => {
    const current = [item('a')]
    expect(reconcileStaging(current, current, [])).toBe(current)
  })

  it('another word got staged while the push was in flight: that entry must survive, alongside whatever the remote merge brought in', () => {
    const pushed = [item('alpha', '2026-07-01'), item('zeta', '2026-07-25')]
    const later = item('later', '2026-07-25')
    const out = reconcileStaging([item('zeta'), later], pushed, [later])
    expect(out.map(i => i.headword).sort()).toEqual(['alpha', 'later', 'zeta'])
  })
})
