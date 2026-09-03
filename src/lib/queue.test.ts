import { describe, expect, it } from 'vitest'
import {
  buildConsolidateQueue, buildLapseQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, LAPSE_SESSION_SIZE,
  MATURE_INTERVAL_DAYS, rankStrugglingWords, strugglingPracticePool,
} from './queue'
import { INITIAL_EASE } from './srs'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, Word } from '../types'

const word = (id: string, usageScore?: number): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
  ...(usageScore === undefined ? {} : { usageScore }),
})
const words = ['alpha', 'bravo', 'carol', 'delta', 'echo'].map(id => word(id))

const prog = (): Progress => {
  const p = emptyProgress()
  p.settings.newPerDay = 2
  p.words['alpha'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
  p.words['bravo'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
  p.words['carol'] = { state: 'review', ease: 2.5, intervalDays: 30, due: '2026-08-10', stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-07-10T00:00:00Z' }
  return p
}

describe('buildQueue', () => {
  it('due words go into due: learning takes priority, then sorted by due date; not-yet-due words are excluded', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.due).toEqual(['bravo', 'alpha'])
  })
  it('new word count = newPerDay minus today\'s already-learned count', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.fresh).toHaveLength(2)
    const p2 = prog()
    p2.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 1, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p2, '2026-07-24').fresh).toHaveLength(1)
  })
  it('empty once the new-word quota is used up', () => {
    const p = prog()
    p.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 2, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p, '2026-07-24').fresh).toEqual([])
  })
})

describe('buildQueue — prioritized by encounter probability', () => {
  /**
   * Only newPerDay new words are learned each day, so which ones get picked determines the
   * return on that investment. It used to be `.slice(0, budget)` — array order — so whichever
   * word entered the list first got learned first, meaning newly added words wouldn't come up
   * for months, and whether you ended up learning a common word was pure luck.
   */
  const p = (newPerDay: number): Progress => {
    const x = emptyProgress()
    x.settings.newPerDay = newPerDay
    return x
  }

  it('new words are taken by encounter probability from high to low, regardless of their position in the word list', () => {
    const ws = [word('rare', 2), word('common', 9), word('mid', 5)]
    expect(buildQueue(ws, p(2), '2026-07-24').fresh).toEqual(['common', 'mid'])
  })

  it('ties are broken by a hash of the id, not by word-list position — that position is capture order, i.e. a synonym walk', () => {
    const ws = [word('alpha', 5), word('bravo', 5), word('carol', 5)]
    const reversed = [...ws].reverse()
    expect(buildQueue(ws, p(3), '2026-07-24').fresh)
      .toEqual(buildQueue(reversed, p(3), '2026-07-24').fresh)
  })

  it('words missing usageScore sort last — unscored does not mean high-frequency, it should not jump the queue', () => {
    const ws = [word('unscored'), word('low', 1)]
    expect(buildQueue(ws, p(2), '2026-07-24').fresh).toEqual(['low', 'unscored'])
  })

  it('when review words tie on state and due date, sort by encounter probability, not alphabetically', () => {
    const ws = [word('apple', 3), word('zebra', 9)]
    const x = emptyProgress()
    const entry = { state: 'review' as const, ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
    x.words['apple'] = { ...entry }
    x.words['zebra'] = { ...entry }
    expect(buildQueue(ws, x, '2026-07-24').due).toEqual(['zebra', 'apple'])
  })

  it('encounter probability is only a last-resort tiebreaker: it does not affect learning-first or due-date-first priority', () => {
    const ws = [word('lowLearning', 1), word('highReview', 10), word('highLate', 10)]
    const x = emptyProgress()
    x.words['lowLearning'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
    x.words['highReview'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-10', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-05T00:00:00Z' }
    x.words['highLate'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-22', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-17T00:00:00Z' }
    // the learning word scoring 1 still comes first; between the two words scoring 10, the earlier due date comes first
    expect(buildQueue(ws, x, '2026-07-24').due).toEqual(['lowLearning', 'highReview', 'highLate'])
  })
})

// Shared by the two struggling-words suites below. Default ease is one
// lapse's worth below initial (2.5 − 0.2): a real lapsed-and-not-recovered
// entry, since a lapse always costs ease and only "easy" gives it back.
const strugglingEntry = (lapses: number, over: Partial<ProgressEntry> = {}) => ({
  state: 'review' as const, ease: INITIAL_EASE - 0.2, intervalDays: 5, due: '2099-01-01',
  stepIndex: 0, reps: 9, lapses, lastReviewedAt: '2026-07-15T00:00:00Z', ...over,
})

describe('rankStrugglingWords', () => {
  const withEase = (spec: Record<string, number>): Progress => {
    const p = emptyProgress()
    for (const [id, ease] of Object.entries(spec)) p.words[id] = strugglingEntry(1, { ease })
    return p
  }
  const ids = (ws: Word[]) => ws.map(w => w.id)

  it('a word sitting at initial ease is not struggling — it has never drawn blood, or has been forgiven', () => {
    const p = emptyProgress()
    p.words['baseline'] = strugglingEntry(0, { ease: INITIAL_EASE })
    expect(rankStrugglingWords([word('baseline')], p)).toEqual([])
  })

  it('a word that lapsed but recovered above initial ease has earned its exit, lapses notwithstanding', () => {
    const p = emptyProgress()
    p.words['forgiven'] = strugglingEntry(3, { ease: INITIAL_EASE + 0.1 })
    expect(rankStrugglingWords([word('forgiven')], p)).toEqual([])
  })

  it('a word never outright forgotten but graded "hard" counts — invisible to any lapse-count ranking', () => {
    const p = emptyProgress()
    p.words['squinted'] = strugglingEntry(0, { ease: INITIAL_EASE - 0.15 })
    expect(ids(rankStrugglingWords([word('squinted')], p))).toEqual(['squinted'])
  })

  it('a word carried to maturity exits even if its ease never recovered', () => {
    const p = emptyProgress()
    p.words['carried'] = strugglingEntry(1, { ease: 1.3, intervalDays: MATURE_INTERVAL_DAYS })
    p.words['shaky'] = strugglingEntry(1, { ease: 1.3, intervalDays: MATURE_INTERVAL_DAYS - 1 })
    expect(ids(rankStrugglingWords([word('carried'), word('shaky')], p))).toEqual(['shaky'])
  })

  it('lowest ease first — the scheduler\'s own estimate of which word costs the most', () => {
    const ws = [word('mild'), word('worst'), word('bad')]
    expect(ids(rankStrugglingWords(ws, withEase({ mild: 2.35, worst: 1.5, bad: 1.9 }))))
      .toEqual(['worst', 'bad', 'mild'])
  })

  it('ease ties break by lapse count — among equally hard words, the one actually forgotten leads', () => {
    const p = emptyProgress()
    p.words['forgotten'] = strugglingEntry(2)
    p.words['squinted'] = strugglingEntry(0)
    expect(ids(rankStrugglingWords([word('squinted'), word('forgotten')], p))).toEqual(['forgotten', 'squinted'])
  })

  it('ease and lapses both tied: common words first, then id for determinism', () => {
    const ws = [word('rare', 2), word('common', 9)]
    const p = emptyProgress()
    p.words['rare'] = strugglingEntry(1)
    p.words['common'] = strugglingEntry(1)
    expect(ids(rankStrugglingWords(ws, p))).toEqual(['common', 'rare'])
  })

  it('keeps words reviewed today — the stats card must not blink out an hour after a drill', () => {
    const p = emptyProgress()
    p.words['drilledToday'] = strugglingEntry(1, { lastReviewedAt: '2026-07-24T09:00:00Z' })
    expect(ids(rankStrugglingWords([word('drilledToday')], p))).toEqual(['drilledToday'])
    expect(buildLapseQueue([word('drilledToday')], p, '2026-07-24')).toEqual([])
  })

  it('words never reviewed are excluded (no record in progress)', () => {
    expect(rankStrugglingWords([word('a')], emptyProgress())).toEqual([])
  })

  it('is uncapped — the stats leaderboard slices it itself', () => {
    const ws = Array.from({ length: 30 }, (_, i) => word(`w${i}`))
    const p = emptyProgress()
    ws.forEach((w, i) => { p.words[w.id] = strugglingEntry(i) })
    expect(rankStrugglingWords(ws, p)).toHaveLength(30)
  })
})

describe('buildLapseQueue', () => {
  const TODAY = '2026-07-24'
  const withLapses = (spec: Record<string, number>): Progress => {
    const p = emptyProgress()
    for (const [id, n] of Object.entries(spec)) p.words[id] = strugglingEntry(n)
    return p
  }

  it('with no recent miss in play, same order as rankStrugglingWords', () => {
    const p = emptyProgress()
    p.words['mild'] = strugglingEntry(1, { ease: 2.35 })
    p.words['worst'] = strugglingEntry(1, { ease: 1.5 })
    expect(buildLapseQueue([word('mild'), word('worst')], p, TODAY)).toEqual(['worst', 'mild'])
  })

  it('a word missed in a quiz is drilled even though nothing about its schedule says it is hard', () => {
    // The case the whole field exists for: healthy ease, a long interval, so
    // rankStrugglingWords will never see it — and before missedAt the only
    // way to surface it was to pull `due` forward, which is what inflated
    // the schedule.
    const p = emptyProgress()
    p.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 90, due: '2026-10-20', stepIndex: 0, reps: 6, lapses: 0, lastReviewedAt: '2026-07-22T00:00:00Z', missedAt: TODAY }
    expect(rankStrugglingWords([word('a')], p)).toEqual([])
    expect(buildLapseQueue([word('a')], p, TODAY)).toEqual(['a'])
  })

  it('a fresh miss leads the durable strugglers — the newer observation first', () => {
    const p = emptyProgress()
    p.words['struggler'] = strugglingEntry(3, { ease: 1.4 })
    p.words['missed'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z', missedAt: TODAY }
    expect(buildLapseQueue([word('struggler'), word('missed')], p, TODAY)).toEqual(['missed', 'struggler'])
  })

  it('more recent misses lead older ones', () => {
    const p = emptyProgress()
    const missed = (missedAt: string) => ({ state: 'review' as const, ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt })
    p.words['old'] = missed('2026-07-20')
    p.words['new'] = missed('2026-07-23')
    expect(buildLapseQueue([word('old'), word('new')], p, TODAY)).toEqual(['new', 'old'])
  })

  it('a miss older than the recency window drops out — it is a ceiling, not a sentence', () => {
    const at = (missedAt: string): Progress => {
      const q = emptyProgress()
      q.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt }
      return q
    }
    expect(buildLapseQueue([word('a')], at('2026-07-18'), TODAY)).toEqual(['a'])   // 6 days ago
    expect(buildLapseQueue([word('a')], at('2026-07-17'), TODAY)).toEqual(['a'])   // exactly MISS_RECENCY_DAYS
    expect(buildLapseQueue([word('a')], at('2026-07-16'), TODAY)).toEqual([])      // one day past
  })

  it('a word that is both recently missed and struggling appears once', () => {
    const p = emptyProgress()
    p.words['both'] = strugglingEntry(2, { ease: 1.6, missedAt: TODAY })
    expect(buildLapseQueue([word('both')], p, TODAY)).toEqual(['both'])
  })

  it('a new word is never drilled on a miss — it has no schedule to protect yet', () => {
    const p = emptyProgress()
    p.words['a'] = { state: 'new', ease: INITIAL_EASE, intervalDays: 0, due: TODAY, stepIndex: 0, reps: 0, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt: TODAY }
    expect(buildLapseQueue([word('a')], p, TODAY)).toEqual([])
  })

  it('ignores the due date — struggling words are actively cleared, not waited on until due', () => {
    // strugglingEntry() always gives due: 2099, so the normal queue would pick none of them
    const ws = [word('a')]
    expect(buildQueue(ws, withLapses({ a: 4 }), TODAY).due).toEqual([])
    expect(buildLapseQueue(ws, withLapses({ a: 4 }), TODAY)).toEqual(['a'])
  })

  it('capped count', () => {
    const ws = Array.from({ length: 30 }, (_, i) => word(`w${i}`))
    const spec = Object.fromEntries(ws.map((w, i) => [w.id, i + 1]))
    expect(buildLapseQueue(ws, withLapses(spec), TODAY)).toHaveLength(20)
    expect(buildLapseQueue(ws, withLapses(spec), TODAY, 5)).toHaveLength(5)
  })

  it('returns empty when no word is struggling at all', () => {
    expect(buildLapseQueue([word('a')], emptyProgress(), TODAY)).toEqual([])
  })

  it('a word genuinely reviewed today drops out until tomorrow — no point drilling what you just did', () => {
    const p = emptyProgress()
    p.words['a'] = strugglingEntry(2, { lastReviewedAt: '2026-07-24T09:00:00Z' })
    expect(buildLapseQueue([word('a')], p, TODAY)).toEqual([])
    expect(buildLapseQueue([word('a')], p, '2026-07-25')).toEqual(['a'])
  })

  it('"today" is the local day, not the UTC prefix of lastReviewedAt', () => {
    // 2026-07-25T02:00Z is still the evening of the 24th anywhere west of
    // Greenwich; slicing the ISO string would wrongly call it a new day.
    const p = emptyProgress()
    p.words['a'] = strugglingEntry(2, { lastReviewedAt: new Date(2026, 6, 24, 19, 0).toISOString() })
    expect(buildLapseQueue([word('a')], p, TODAY)).toEqual([])
  })
})

describe('buildConsolidateQueue', () => {
  const TODAY = '2026-07-24'
  /** hoursAgo is relative to `now` below, so the delay gate can be exercised without faking timers. */
  const now = new Date(2026, 6, 24, 20, 0)
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString()
  const entry = (over: Partial<{ state: 'learning' | 'review' | 'new'; intervalDays: number; lastReviewedAt: string }> = {}) => ({
    state: 'review' as const, ease: 2.5, intervalDays: 1, due: '2026-07-25',
    stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: at(CONSOLIDATE_DELAY_HOURS + 1), ...over,
  })

  it('picks up the words learned today once the delay has passed', () => {
    const p = emptyProgress()
    p.words['a'] = entry()
    expect(buildConsolidateQueue([word('a')], p, now, TODAY)).toEqual(['a'])
  })

  it('a word learned minutes ago is not ready — that would just be the same sitting', () => {
    const p = emptyProgress()
    p.words['fresh'] = entry({ lastReviewedAt: at(CONSOLIDATE_DELAY_HOURS - 0.5) })
    expect(buildConsolidateQueue([word('fresh')], p, now, TODAY)).toEqual([])
  })

  it('mature words are never included, however long ago they were reviewed', () => {
    const p = emptyProgress()
    p.words['mature'] = entry({ intervalDays: CONSOLIDATE_MAX_INTERVAL_DAYS + 1, lastReviewedAt: at(9) })
    expect(buildConsolidateQueue([word('mature')], p, now, TODAY)).toEqual([])
  })

  it('words last seen on an earlier day are not part of today learning', () => {
    const p = emptyProgress()
    p.words['yesterday'] = entry({ lastReviewedAt: new Date(2026, 6, 23, 20, 0).toISOString() })
    expect(buildConsolidateQueue([word('yesterday')], p, now, TODAY)).toEqual([])
  })

  it('a word still in the learning phase counts — it is the most fragile thing in the day', () => {
    const p = emptyProgress()
    p.words['stuck'] = entry({ state: 'learning', intervalDays: 0 })
    expect(buildConsolidateQueue([word('stuck')], p, now, TODAY)).toEqual(['stuck'])
  })

  it('untouched words are excluded', () => {
    const p = emptyProgress()
    p.words['neverStarted'] = entry({ state: 'new' })
    expect(buildConsolidateQueue([word('neverStarted'), word('noRecord')], p, now, TODAY)).toEqual([])
  })

  it('oldest first: the word learned at breakfast has had the longest to fade', () => {
    const p = emptyProgress()
    p.words['morning'] = entry({ lastReviewedAt: at(11) })
    p.words['noon'] = entry({ lastReviewedAt: at(7) })
    p.words['afternoon'] = entry({ lastReviewedAt: at(4) })
    expect(buildConsolidateQueue([word('afternoon'), word('noon'), word('morning')], p, now, TODAY))
      .toEqual(['morning', 'noon', 'afternoon'])
  })

  it('is not capped — a heavy learning day must not be silently truncated', () => {
    const ws = Array.from({ length: 40 }, (_, i) => word(`w${i}`))
    const p = emptyProgress()
    ws.forEach((w, i) => { p.words[w.id] = entry({ lastReviewedAt: at(4 + i / 60) }) })
    expect(buildConsolidateQueue(ws, p, now, TODAY)).toHaveLength(40)
  })
})

describe('strugglingPracticePool: the drill queue before the daily narrowing', () => {
  const TODAY = '2026-07-24'

  it('recent misses lead by recency, then the ease ranking, deduplicated', () => {
    const p = emptyProgress()
    p.words['struggler'] = strugglingEntry(3, { ease: 1.4 })
    p.words['both'] = strugglingEntry(2, { ease: 1.6, missedAt: TODAY })
    p.words['missed'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z', missedAt: '2026-07-23' }
    const ws = [word('struggler'), word('both'), word('missed')]
    // 'both' (missed today) before 'missed' (yesterday); 'struggler' enters
    // via the ranking; 'both' appears exactly once despite qualifying twice.
    expect(strugglingPracticePool(ws, p, TODAY).map(w => w.id)).toEqual(['both', 'missed', 'struggler'])
  })

  it('is uncapped — the daily session size bounds the drill, not the pool', () => {
    const ws = Array.from({ length: LAPSE_SESSION_SIZE + 7 }, (_, i) => word(`w${i}`))
    const p = emptyProgress()
    ws.forEach((w, i) => { p.words[w.id] = strugglingEntry(i) })
    expect(strugglingPracticePool(ws, p, TODAY)).toHaveLength(LAPSE_SESSION_SIZE + 7)
  })

  it('keeps words reviewed today — the unlimited walk may repeat them; the drill must not', () => {
    const p = emptyProgress()
    p.words['drilledToday'] = strugglingEntry(1, { lastReviewedAt: '2026-07-24T09:00:00Z' })
    expect(strugglingPracticePool([word('drilledToday')], p, TODAY).map(w => w.id)).toEqual(['drilledToday'])
    expect(buildLapseQueue([word('drilledToday')], p, TODAY)).toEqual([])
  })

  it('a miss outside the recency window with healthy ease is not in the pool at all', () => {
    const p = emptyProgress()
    p.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt: '2026-07-16' }
    expect(strugglingPracticePool([word('a')], p, TODAY)).toEqual([])
  })
})
