import { describe, expect, it } from 'vitest'
import { bumpUntangleSessions, buildDayPlan, nextAction, untangleSessionsToday } from './todayPlan'
import type { LocalMarks, PlanItem } from './todayPlan'
import { emptyProgress, emptyStat } from '../types'
import type { Progress, ProgressEntry, TangleStat, Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-08-01',
})

const entry = (over: Partial<ProgressEntry>): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 5, due: '2026-09-01', stepIndex: 0,
  reps: 3, lapses: 0, lastReviewedAt: '2026-08-01T08:00:00.000Z', ...over,
})

const TODAY = '2026-08-07'
// 21:00 local — safely past the 3-hour consolidation window for anything learned in the morning
const NOW = new Date(2026, 7, 7, 21, 0, 0)
const NO_MARKS: LocalMarks = { lapseDrilledOn: null, consolidatedOn: null, untangleSessions: null }

const find = (plan: PlanItem[], key: string) => plan.find(p => p.key === key)

/** An open tangle of two members, due yesterday. */
const tangle = (members: string[], over: Partial<TangleStat> = {}): TangleStat => ({
  pairs: [`${members[0]}|${members[1]}`], members, settled: [],
  bornOn: '2026-08-05', dueOn: '2026-08-06', lastAt: '2026-08-05T08:00:00.000Z', ...over,
})

/** `n` due tangles over words t0…t(2n−1), every one of them in the library and in the review phase with nothing due. */
const withDueTangles = (n: number): { words: Word[]; progress: Progress } => {
  const words: Word[] = []
  const progress = emptyProgress()
  progress.settings.newPerDay = 0
  progress.tangles = {}
  for (let i = 0; i < n; i++) {
    const a = `t${2 * i}`, b = `t${2 * i + 1}`
    words.push(word(a), word(b))
    progress.words[a] = entry({})
    progress.words[b] = entry({})
    progress.tangles[`${a}|${b}`] = tangle([a, b])
  }
  return { words, progress }
}

describe('buildDayPlan', () => {
  it('due row: todo with count while words are due, done at zero', () => {
    const words = [word('a'), word('b')]
    const p: Progress = { ...emptyProgress(), words: {
      a: entry({ due: TODAY }),
      b: entry({ due: '2026-09-01' }),
    } }
    p.settings.newPerDay = 0
    const plan = buildDayPlan(words, p, NOW, TODAY, NO_MARKS)
    expect(find(plan, 'due')).toMatchObject({ state: 'todo', count: 1, to: '/review' })

    p.words.a = entry({ due: '2026-09-01' })
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'due')).toMatchObject({ state: 'done', count: 0 })
  })

  it('fresh row: counts budgeted new words and hints at what was already learned', () => {
    const words = [word('a'), word('b'), word('c')]
    const p = emptyProgress()
    p.settings.newPerDay = 2
    p.dailyStats[TODAY] = { ...emptyStat(), newLearned: 1 }
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'fresh')
    // budget 2 - learned 1 = 1 slot left
    expect(row).toMatchObject({ state: 'todo', count: 1, hint: '已学 1' })
  })

  it('consolidate row: todo when a word learned this morning has faded past the window', () => {
    const words = [word('a')]
    const p = emptyProgress()
    // learned at 09:00 local today, interval within the fragile band
    p.words.a = entry({ state: 'learning', intervalDays: 0, due: TODAY,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    p.settings.newPerDay = 0
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'consolidate')
    expect(row).toMatchObject({ state: 'todo', count: 1, to: '/review?mode=consolidate' })
  })

  it('consolidate row: pending while today\'s words are still inside the 3-hour window', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    // learned 30 minutes before NOW
    p.words.a = entry({ state: 'learning', intervalDays: 0, due: TODAY,
      lastReviewedAt: new Date(2026, 7, 7, 20, 30, 0).toISOString() })
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'consolidate')
    expect(row?.state).toBe('pending')
  })

  it('consolidate row: done when today\'s marker is set, hidden when nothing was learned today', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({ state: 'learning', intervalDays: 0, due: TODAY,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    const done = buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, consolidatedOn: TODAY })
    expect(find(done, 'consolidate')?.state).toBe('done')

    const idle = emptyProgress()
    idle.settings.newPerDay = 0
    expect(find(buildDayPlan([], idle, NOW, TODAY, NO_MARKS), 'consolidate')).toBeUndefined()
  })

  it('lapses row: todo with queue size, done when drilled today, hidden with no struggling words', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    // ease below initial and immature → struggling; last reviewed yesterday → drillable
    p.words.a = entry({ ease: 2.1, intervalDays: 3, lastReviewedAt: '2026-08-06T08:00:00.000Z' })
    // The pool size goes in the hint, never in `count`. That slot is the
    // remaining-work number 复习到期 and 学习新词 print, and this row cannot
    // be driven to zero by using it: every exit from the pool belongs to
    // the scheduled review, and the walk's own misses only add to it.
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'lapses')
    expect(row).toMatchObject({ state: 'todo', hint: '池子里 1 个' })
    expect(row?.count).toBeUndefined()
    expect(find(buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, lapseDrilledOn: TODAY }), 'lapses')?.state)
      .toBe('done')

    const healthy = emptyProgress()
    healthy.settings.newPerDay = 0
    healthy.words.a = entry({})
    expect(find(buildDayPlan(words, healthy, NOW, TODAY, NO_MARKS), 'lapses')).toBeUndefined()
  })

  it('lapses row: a word reviewed today is still stubborn, so the row stays todo', () => {
    // The capped drill hid words reviewed today, so the row could reach
    // 'done' from the data alone. The walk hides nothing and never ends, so
    // only the local marker can say a day is done — asserted above.
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({ ease: 2.1, intervalDays: 3,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'lapses'))
      .toMatchObject({ state: 'todo', hint: '池子里 1 个', to: '/practice?pick=struggling' })
  })

  it('lapses row: ticked for the day, but still a way in while the pool has words', () => {
    // The row used to go inert once ticked, like every done row, and 今日
    // carried a separate 顽固词加练 card as the durable entry to the same
    // screen — two ways into one walk on the same page. Inert is right for
    // 复习到期 and friends, whose done means empty. Here done means you sat
    // down with them today, and the pool is still there.
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({ ease: 2.1, intervalDays: 3 })
    expect(find(buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, lapseDrilledOn: TODAY }), 'lapses'))
      .toMatchObject({ state: 'done', reopenable: true, hint: '池子里 1 个', to: '/practice?pick=struggling' })
  })

  it('lapses row: ticked with an empty pool is not reopenable — the walk would only say there is nothing to do', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({})
    const row = find(buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, lapseDrilledOn: TODAY }), 'lapses')
    expect(row?.state).toBe('done')
    expect(row?.reopenable).toBeUndefined()
    expect(row?.hint).toBeUndefined()
  })

  it('no other row is reopenable: their done means there is nothing left', () => {
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.dailyStats[TODAY] = { ...emptyStat(), quizTaken: 1 }
    const plan = buildDayPlan([], p, NOW, TODAY, { lapseDrilledOn: null, consolidatedOn: TODAY, untangleSessions: null })
    expect(plan.filter(r => r.state === 'done').length).toBeGreaterThan(0)
    expect(plan.filter(r => r.key !== 'lapses' && r.reopenable)).toEqual([])
  })

  it('untangle row: hidden with no due tangle', () => {
    const { words, progress } = withDueTangles(0)
    expect(find(buildDayPlan(words, progress, NOW, TODAY, NO_MARKS), 'untangle')).toBeUndefined()

    // Open but not due until tomorrow (born today): day 1 belongs to 复习完成, not here.
    const later = withDueTangles(1)
    later.progress.tangles = { 't0|t1': tangle(['t0', 't1'], { bornOn: TODAY, dueOn: '2026-08-08' }) }
    expect(find(buildDayPlan(later.words, later.progress, NOW, TODAY, NO_MARKS), 'untangle')).toBeUndefined()
  })

  it('untangle row: liveness is the word list, so a tangle whose words were deleted is not owed', () => {
    // The user deletes words in the app and from another device; their
    // progress entries can outlive them, so `progress.words` is not the test.
    const { progress } = withDueTangles(1)
    expect(find(buildDayPlan([word('t0')], progress, NOW, TODAY, NO_MARKS), 'untangle')).toBeUndefined()
  })

  it('untangle row: todo with count min(due, 3 − sessions today)', () => {
    const { words, progress } = withDueTangles(5)
    const marks: LocalMarks = { ...NO_MARKS, untangleSessions: { day: TODAY, n: 1 } }
    expect(find(buildDayPlan(words, progress, NOW, TODAY, marks), 'untangle'))
      .toMatchObject({ label: '拆开缠在一起的词', state: 'todo', count: 2, to: '/untangle' })

    // Fewer due than the day has room for: the count is what is due.
    const one = withDueTangles(1)
    expect(find(buildDayPlan(one.words, one.progress, NOW, TODAY, NO_MARKS), 'untangle'))
      .toMatchObject({ state: 'todo', count: 1 })
  })

  it('untangle row: done but reopenable after 3 sessions while more are due', () => {
    // The cap is a default, not a wall (spec §3): the day's share is done,
    // and the rest are still a tap away.
    const { words, progress } = withDueTangles(2)
    const marks: LocalMarks = { ...NO_MARKS, untangleSessions: { day: TODAY, n: 3 } }
    const row = find(buildDayPlan(words, progress, NOW, TODAY, marks), 'untangle')
    expect(row).toMatchObject({ state: 'done', reopenable: true, hint: '还有 2 团', to: '/untangle' })
    expect(row?.count).toBeUndefined()
  })

  it('untangle row: done, not hidden, once a session ran today and none are left due', () => {
    // A finished day's work must not vanish from the plan: the same reason
    // 巩固's row stays as done once its marker is set.
    const { words, progress } = withDueTangles(0)
    const row = find(buildDayPlan(words, progress, NOW, TODAY, { ...NO_MARKS, untangleSessions: { day: TODAY, n: 1 } }), 'untangle')
    expect(row).toMatchObject({ state: 'done', to: '/untangle' })
    expect(row?.count).toBeUndefined()
    expect(row?.reopenable).toBeUndefined()
    expect(row?.hint).toBeUndefined()
  })

  it('untangle row: a mark from another day counts as 0 sessions', () => {
    const { words, progress } = withDueTangles(5)
    const marks: LocalMarks = { ...NO_MARKS, untangleSessions: { day: '2026-08-06', n: 3 } }
    expect(find(buildDayPlan(words, progress, NOW, TODAY, marks), 'untangle'))
      .toMatchObject({ state: 'todo', count: 3 })
    // And with nothing due, yesterday's sessions do not tick today's row.
    const none = withDueTangles(0)
    expect(find(buildDayPlan(none.words, none.progress, NOW, TODAY, marks), 'untangle')).toBeUndefined()
  })

  it('untangle row: sits after 专攻顽固词 and before the optional quiz', () => {
    const { words, progress } = withDueTangles(1)
    words.push(word('s'))
    progress.words.s = entry({ ease: 2.1, intervalDays: 3 })
    const keys = buildDayPlan(words, progress, NOW, TODAY, NO_MARKS).map(r => r.key)
    expect(keys.indexOf('untangle')).toBe(keys.indexOf('lapses') + 1)
    expect(keys.indexOf('quiz')).toBe(keys.indexOf('untangle') + 1)
  })
})

describe('untangle session mark', () => {
  it('counts only today\'s sessions, and reads a malformed mark as none', () => {
    expect(untangleSessionsToday(null, TODAY)).toBe(0)
    expect(untangleSessionsToday({ day: TODAY, n: 2 }, TODAY)).toBe(2)
    expect(untangleSessionsToday({ day: '2026-08-06', n: 2 }, TODAY)).toBe(0)
    // localStorage hands back whatever JSON is there; a hand-edited or
    // half-written mark must not read as sessions done.
    for (const bad of [{ day: TODAY, n: '2' }, { day: TODAY, n: -1 }, { day: TODAY, n: Number.NaN }, { day: TODAY }, 'x', 3]) {
      expect(untangleSessionsToday(bad as unknown as LocalMarks['untangleSessions'], TODAY)).toBe(0)
    }
  })

  it('a finished session adds one to today and starts a new day at one', () => {
    expect(bumpUntangleSessions(null, TODAY)).toEqual({ day: TODAY, n: 1 })
    expect(bumpUntangleSessions({ day: TODAY, n: 2 }, TODAY)).toEqual({ day: TODAY, n: 3 })
    expect(bumpUntangleSessions({ day: '2026-08-06', n: 3 }, TODAY)).toEqual({ day: TODAY, n: 1 })
  })

  it('quiz row: always present, done once any quiz was taken today', () => {
    const p = emptyProgress()
    p.settings.newPerDay = 0
    expect(find(buildDayPlan([], p, NOW, TODAY, NO_MARKS), 'quiz'))
      .toMatchObject({ state: 'todo', hint: '可选', to: '/quiz' })
    p.dailyStats[TODAY] = { ...emptyStat(), quizTaken: 1 }
    expect(find(buildDayPlan([], p, NOW, TODAY, NO_MARKS), 'quiz')?.state).toBe('done')
  })
})

describe('nextAction', () => {
  const row = (key: PlanItem['key'], state: PlanItem['state'], count?: number): PlanItem =>
    ({ key, label: 'x', state, count, to: '/x' })

  it('review first: combines due and fresh counts', () => {
    const hero = nextAction([row('due', 'todo', 3), row('fresh', 'todo', 2), row('quiz', 'todo')])
    expect(hero).toMatchObject({ kind: 'review', count: 5, to: '/review' })
  })

  it('falls through review → consolidate → lapses', () => {
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('consolidate', 'todo', 4), row('lapses', 'todo', 2), row('quiz', 'todo')]).kind)
      .toBe('consolidate')
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('lapses', 'todo'), row('quiz', 'todo')]).kind)
      .toBe('lapses')
  })

  it('the lapses hero carries no count — the pool is a stock, and the number slot is for a to-do', () => {
    const hero = nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('lapses', 'todo'), row('quiz', 'todo')])
    expect(hero).toMatchObject({ kind: 'lapses', to: '/practice?pick=struggling' })
    expect('count' in hero).toBe(false)
  })

  it('untangle todo beats lapses todo, and carries the tangles left as its count', () => {
    // Tangles are finishable work, unlike the stubborn pool: each session
    // takes one off today's list, so the number slot means what it says.
    const hero = nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('lapses', 'todo'), row('untangle', 'todo', 2), row('quiz', 'todo')])
    expect(hero).toEqual({
      kind: 'untangle', count: 2, unit: '团',
      meta: '复习时混过的近义词，并排分清', to: '/untangle', label: '开始拆解',
    })
  })

  it('review and consolidate beat untangle', () => {
    expect(nextAction([row('due', 'todo', 1), row('fresh', 'done', 0),
      row('untangle', 'todo', 2), row('quiz', 'todo')]).kind)
      .toBe('review')
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('consolidate', 'todo', 3), row('untangle', 'todo', 2), row('quiz', 'todo')]).kind)
      .toBe('consolidate')
  })

  it('a done untangle row never becomes the hero, reopenable or not', () => {
    // Without the untangle hero, a todo row sat under 今日完成; the reverse
    // mistake would be a hero asking for work the plan says is done.
    const reopenable: PlanItem = { ...row('untangle', 'done'), reopenable: true, hint: '还有 2 团' }
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0), reopenable, row('quiz', 'todo')]).kind)
      .toBe('complete')
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('lapses', 'todo'), reopenable, row('quiz', 'todo')]).kind)
      .toBe('lapses')
  })

  it('a pending consolidation is not an action; quiz never becomes the hero', () => {
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('consolidate', 'pending'), row('quiz', 'todo')]).kind)
      .toBe('complete')
  })
})
