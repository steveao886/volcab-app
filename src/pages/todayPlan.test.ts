import { describe, expect, it } from 'vitest'
import { buildDayPlan, nextAction } from './todayPlan'
import type { PlanItem } from './todayPlan'
import { emptyProgress, emptyStat } from '../types'
import type { Progress, ProgressEntry, Word } from '../types'

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
const NO_MARKS = { lapseDrilledOn: null, consolidatedOn: null }

const find = (plan: PlanItem[], key: string) => plan.find(p => p.key === key)

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
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'lapses'))
      .toMatchObject({ state: 'todo', count: 1 })
    expect(find(buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, lapseDrilledOn: TODAY }), 'lapses')?.state)
      .toBe('done')

    const healthy = emptyProgress()
    healthy.settings.newPerDay = 0
    healthy.words.a = entry({})
    expect(find(buildDayPlan(words, healthy, NOW, TODAY, NO_MARKS), 'lapses')).toBeUndefined()
  })

  it('lapses row: done (not hidden) when every struggling word was already reviewed today', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({ ease: 2.1, intervalDays: 3,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'lapses')?.state).toBe('done')
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
      row('lapses', 'todo', 2), row('quiz', 'todo')]).kind)
      .toBe('lapses')
  })

  it('a pending consolidation is not an action; quiz never becomes the hero', () => {
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('consolidate', 'pending'), row('quiz', 'todo')]).kind)
      .toBe('complete')
  })
})
