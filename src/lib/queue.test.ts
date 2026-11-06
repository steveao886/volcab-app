import { describe, expect, it } from 'vitest'
import {
  buildConsolidateQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, LAPSE_SESSION_SIZE,
  carriedOverCount, gradeSession, MATURE_INTERVAL_DAYS, newQuota, rankStrugglingWords, reviewCap, reviewWordsSpent, strugglingPracticePool,
} from './queue'
import { gradeWord, INITIAL_EASE } from './srs'
import { emptyProgress, emptyStat } from '../types'
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
    // prog()'s alpha is overdue, which since 2026-11-04 would also cut the
    // quota by one; this test is about newLearned, so the day is stamped as
    // carrying nothing over (see 'carried-over reviews' below).
    const p1 = prog()
    p1.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 0, correct: 0, quizTaken: 0, carriedOver: 0 }
    const q = buildQueue(words, p1, '2026-07-24')
    expect(q.fresh).toHaveLength(2)
    const p2 = prog()
    p2.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 1, correct: 0, quizTaken: 0, carriedOver: 0 }
    expect(buildQueue(words, p2, '2026-07-24').fresh).toHaveLength(1)
  })
  it('empty once the new-word quota is used up', () => {
    const p = prog()
    p.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 2, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p, '2026-07-24').fresh).toEqual([])
  })
})

describe('buildQueue spaces related words inside one session', () => {
  const due = (id: string, usageScore: number, over: Partial<ProgressEntry> = {}): [Word, ProgressEntry] => [
    { ...word(id, usageScore) },
    { state: 'review', ease: 2.5, intervalDays: 8, due: '2026-07-24', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-16T00:00:00Z', ...over },
  ]
  /** Everything due today, so the whole set lands in one session. */
  const session = (rows: [Word, ProgressEntry][]): { ws: Word[]; p: Progress } => {
    const p = emptyProgress()
    p.settings.newPerDay = 0
    for (const [w, e] of rows) p.words[w.id] = e
    return { ws: rows.map(([w]) => w), p }
  }
  const gapBetween = (q: string[], a: string, b: string) => Math.abs(q.indexOf(a) - q.indexOf(b))

  it('separates two words the usageScore sort would have served back to back', () => {
    const alpha = { ...word('alpha', 9), synonyms: ['bravo'] }
    const rows: [Word, ProgressEntry][] = [
      [alpha, due('alpha', 9)[1]],
      due('bravo', 9), due('carol', 8), due('delta', 7), due('echo', 6),
      due('foxtrot', 5), due('golf', 4), due('hotel', 3),
    ]
    const { ws, p } = session(rows)
    const q = buildQueue(ws, p, '2026-07-24')
    expect(q.due).toHaveLength(8)
    expect(gapBetween(q.due, 'alpha', 'bravo')).toBeGreaterThan(1)
  })

  it('separates a shared stem with no declared link between them', () => {
    const rows: [Word, ProgressEntry][] = [
      due('resent', 9), due('resentment', 9), due('carol', 8), due('delta', 7),
      due('echo', 6), due('foxtrot', 5), due('golf', 4),
    ]
    const { ws, p } = session(rows)
    const q = buildQueue(ws, p, '2026-07-24')
    expect(gapBetween(q.due, 'resent', 'resentment')).toBeGreaterThan(1)
  })

  it('never reorders a review word ahead of a learning one — mid-consolidation still goes first', () => {
    // alpha and bravo are synonyms, so the pass wants to separate them; it
    // must do that inside the review block rather than by promoting a
    // review word into the learning one.
    const alpha = { ...word('alpha', 9), synonyms: ['bravo'] }
    const rows: [Word, ProgressEntry][] = [
      [alpha, due('alpha', 9)[1]],
      due('bravo', 9),
      due('carol', 1, { state: 'learning', intervalDays: 0 }),
    ]
    const { ws, p } = session(rows)
    expect(buildQueue(ws, p, '2026-07-24').due[0]).toBe('carol')
  })

  it('returns every due word even when the session is too small to separate them', () => {
    const alpha = { ...word('alpha', 9), synonyms: ['bravo'] }
    const rows: [Word, ProgressEntry][] = [[alpha, due('alpha', 9)[1]], due('bravo', 9)]
    const { ws, p } = session(rows)
    expect(buildQueue(ws, p, '2026-07-24').due.sort()).toEqual(['alpha', 'bravo'])
  })

  it('leaves an unrelated session in strict usageScore order', () => {
    const rows: [Word, ProgressEntry][] = [due('alpha', 9), due('bravo', 7), due('carol', 5)]
    const { ws, p } = session(rows)
    expect(buildQueue(ws, p, '2026-07-24').due).toEqual(['alpha', 'bravo', 'carol'])
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

  it('new words are not taken by encounter probability — the newest captures score highest, so that served them first', () => {
    const a = [word('rare', 2), word('common', 9), word('mid', 5)]
    const b = [word('rare', 9), word('common', 2), word('mid', 5)]
    expect(buildQueue(a, p(2), '2026-07-24').fresh).toEqual(buildQueue(b, p(2), '2026-07-24').fresh)
  })

  it('the order is a hash of the id, not word-list position — that position is capture order, i.e. a synonym walk', () => {
    const ws = [word('alpha', 5), word('bravo', 5), word('carol', 5)]
    const reversed = [...ws].reverse()
    expect(buildQueue(ws, p(3), '2026-07-24').fresh)
      .toEqual(buildQueue(reversed, p(3), '2026-07-24').fresh)
  })

  describe('lookback over recently started words', () => {
    // alpha would be today's one new word; it is bravo's synonym.
    const ws = [{ ...word('alpha', 9), synonyms: ['bravo'] }, word('bravo', 5), word('carol', 5)]
    const started = (startedOn?: string): Progress => {
      const x = p(1)
      x.words['bravo'] = {
        state: 'review', ease: 2.5, intervalDays: 1, due: '2026-07-30', stepIndex: 0, reps: 3, lapses: 0,
        lastReviewedAt: '2026-07-21T00:00:00Z', ...(startedOn === undefined ? {} : { startedOn }),
      }
      return x
    }

    it('keeps a word away from a relative started yesterday, or three days ago', () => {
      expect(buildQueue(ws, started('2026-07-23'), '2026-07-24').fresh).toEqual(['carol'])
      expect(buildQueue(ws, started('2026-07-21'), '2026-07-24').fresh).toEqual(['carol'])
    })

    it('lets it through once the relative was started four days ago', () => {
      expect(buildQueue(ws, started('2026-07-20'), '2026-07-24').fresh).toEqual(['alpha'])
    })

    it('counts a relative started today — a session left halfway resumes without it otherwise', () => {
      expect(buildQueue(ws, started('2026-07-24'), '2026-07-24').fresh).toEqual(['carol'])
    })

    it('an entry from before startedOn existed blocks nothing', () => {
      expect(buildQueue(ws, started(), '2026-07-24').fresh).toEqual(['alpha'])
    })
  })

  describe('family lookback', () => {
    // resentment would be today's one new word (india hashes after it); resent is its stem.
    const ws = [word('resentment', 5), word('india', 5)]
    const started = (startedOn: string): Progress => {
      const x = p(1)
      x.words['resent'] = {
        state: 'review', ease: 2.5, intervalDays: 1, due: '2026-07-30', stepIndex: 0, reps: 3, lapses: 0,
        lastReviewedAt: '2026-07-21T00:00:00Z', startedOn,
      }
      return x
    }
    const withResent = [word('resent', 5), ...ws]

    it('keeps a word family apart for FAMILY_LOOKBACK_DAYS, well past the three-day window', () => {
      expect(buildQueue(withResent, started('2026-07-14'), '2026-07-24').fresh).toEqual(['india'])
      expect(buildQueue(withResent, started('2026-07-10'), '2026-07-24').fresh).toEqual(['india'])
    })

    it('lets it through once the family member was started fifteen days ago', () => {
      expect(buildQueue(withResent, started('2026-07-09'), '2026-07-24').fresh).toEqual(['resentment'])
    })
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

/* The buildLapseQueue block stood here. Both of its own rules - a cap of
   twenty and "drop anything reviewed today" - went with 顽固词's capped
   drill on 2026-09-21, and everything else it covered was membership,
   which belongs to strugglingPracticePool and is asserted against it
   below. */

describe('strugglingPracticePool membership, inherited from the retired lapse drill', () => {
  const TODAY = '2026-07-24'
  const ids = (ws: Word[]) => ws.map(w => w.id)
  const withLapses = (spec: Record<string, number>): Progress => {
    const p = emptyProgress()
    for (const [id, n] of Object.entries(spec)) p.words[id] = strugglingEntry(n)
    return p
  }

  it('with no recent miss in play, same order as rankStrugglingWords', () => {
    const p = emptyProgress()
    p.words['mild'] = strugglingEntry(1, { ease: 2.35 })
    p.words['worst'] = strugglingEntry(1, { ease: 1.5 })
    expect(ids(strugglingPracticePool([word('mild'), word('worst')], p, TODAY))).toEqual(['worst', 'mild'])
  })

  it('a word missed in a quiz is drilled even though nothing about its schedule says it is hard', () => {
    // The case the whole field exists for: healthy ease, a long interval, so
    // rankStrugglingWords will never see it - and before missedAt the only
    // way to surface it was to pull `due` forward, which is what inflated
    // the schedule.
    const p = emptyProgress()
    p.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 90, due: '2026-10-20', stepIndex: 0, reps: 6, lapses: 0, lastReviewedAt: '2026-07-22T00:00:00Z', missedAt: TODAY }
    expect(rankStrugglingWords([word('a')], p)).toEqual([])
    expect(ids(strugglingPracticePool([word('a')], p, TODAY))).toEqual(['a'])
  })

  it('more recent misses lead older ones, once ease and lapses have tied', () => {
    const p = emptyProgress()
    const missed = (missedAt: string) => ({ state: 'review' as const, ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt })
    p.words['old'] = missed('2026-07-20')
    p.words['new'] = missed('2026-07-23')
    expect(ids(strugglingPracticePool([word('old'), word('new')], p, TODAY))).toEqual(['new', 'old'])
  })

  it('a miss older than the recency window drops out - it is a ceiling, not a sentence', () => {
    const at = (missedAt: string): Progress => {
      const q = emptyProgress()
      q.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt }
      return q
    }
    expect(ids(strugglingPracticePool([word('a')], at('2026-07-18'), TODAY))).toEqual(['a'])   // 6 days ago
    expect(ids(strugglingPracticePool([word('a')], at('2026-07-17'), TODAY))).toEqual(['a'])   // exactly MISS_RECENCY_DAYS
    expect(ids(strugglingPracticePool([word('a')], at('2026-07-16'), TODAY))).toEqual([])      // one day past
  })

  it('a new word is never drilled on a miss - it has no schedule to protect yet', () => {
    const p = emptyProgress()
    p.words['a'] = { state: 'new', ease: INITIAL_EASE, intervalDays: 0, due: TODAY, stepIndex: 0, reps: 0, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt: TODAY }
    expect(strugglingPracticePool([word('a')], p, TODAY)).toEqual([])
  })

  it('ignores the due date - struggling words are actively cleared, not waited on until due', () => {
    // strugglingEntry() always gives due: 2099, so the normal queue would pick none of them
    const ws = [word('a')]
    expect(buildQueue(ws, withLapses({ a: 4 }), TODAY).due).toEqual([])
    expect(ids(strugglingPracticePool(ws, withLapses({ a: 4 }), TODAY))).toEqual(['a'])
  })

  it('returns empty when no word is struggling at all', () => {
    expect(strugglingPracticePool([word('a')], emptyProgress(), TODAY)).toEqual([])
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

  it('orders by ease, not by how recently the word was missed, and deduplicates', () => {
    const p = emptyProgress()
    p.words['struggler'] = strugglingEntry(3, { ease: 1.4 })
    p.words['both'] = strugglingEntry(2, { ease: 1.6, missedAt: TODAY })
    p.words['missed'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z', missedAt: '2026-07-23' }
    const ws = [word('struggler'), word('both'), word('missed')]
    // Hardest first: 1.4, then 1.6, then the missed word sitting at initial
    // ease — which under the old rule led the whole list because it had been
    // missed. 'both' appears exactly once despite qualifying twice.
    expect(strugglingPracticePool(ws, p, TODAY).map(w => w.id)).toEqual(['struggler', 'both', 'missed'])
  })

  it('a recent miss breaks a tie between two words the scheduler rates the same', () => {
    // The miss did not stop being information — it stopped being a section.
    const p = emptyProgress()
    p.words['quiet'] = strugglingEntry(1, { ease: 1.9 })
    p.words['missedToday'] = strugglingEntry(1, { ease: 1.9, missedAt: TODAY })
    const ws = [word('quiet'), word('missedToday')]
    expect(strugglingPracticePool(ws, p, TODAY).map(w => w.id)).toEqual(['missedToday', 'quiet'])
  })

  it('is uncapped — a sitting bounds what you do, not what qualifies', () => {
    const ws = Array.from({ length: LAPSE_SESSION_SIZE + 7 }, (_, i) => word(`w${i}`))
    const p = emptyProgress()
    ws.forEach((w, i) => { p.words[w.id] = strugglingEntry(i) })
    expect(strugglingPracticePool(ws, p, TODAY)).toHaveLength(LAPSE_SESSION_SIZE + 7)
  })

  it('keeps words reviewed today — the walk may repeat them, and nothing narrows it any more', () => {
    // The capped drill filtered these out so that one pass could empty the
    // list for the day. The walk has no such pass, so a word you drilled an
    // hour ago is still stubborn and still in the pool.
    const p = emptyProgress()
    p.words['drilledToday'] = strugglingEntry(1, { lastReviewedAt: '2026-07-24T09:00:00Z' })
    expect(strugglingPracticePool([word('drilledToday')], p, TODAY).map(w => w.id)).toEqual(['drilledToday'])
  })

  it('a miss outside the recency window with healthy ease is not in the pool at all', () => {
    const p = emptyProgress()
    p.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt: '2026-07-16' }
    expect(strugglingPracticePool([word('a')], p, TODAY)).toEqual([])
  })
})

/**
 * Reviews carried over from earlier days take the new words' places, one for
 * one — see docs/superpowers/specs/2026-11-04-carried-over-reviews-design.md.
 */
describe('carried-over reviews', () => {
  const T = '2026-07-24'
  const entry = (state: ProgressEntry['state'], due: string): ProgressEntry =>
    ({ state, ease: 2.5, intervalDays: state === 'review' ? 5 : 0, due, stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z' })
  /** n review words due yesterday, then `fresh` unstarted words. */
  const library = (overdue: number, fresh = 5) => {
    const ws = [...Array(overdue + fresh).keys()].map(i => word(`w${String(i).padStart(2, '0')}`))
    const p = emptyProgress()
    p.settings.newPerDay = 3
    for (const w of ws.slice(0, overdue)) p.words[w.id] = entry('review', '2026-07-23')
    return { ws, p }
  }

  it('the quota loses one new word per carried-over review, and never goes below zero', () => {
    expect(newQuota(12, 0)).toBe(12)
    expect(newQuota(12, 5)).toBe(7)
    expect(newQuota(12, 12)).toBe(0)
    expect(newQuota(12, 68)).toBe(0)
    expect(newQuota(3, 5)).toBe(0)
  })

  it('counts started words due before today, review and learning alike', () => {
    const p = emptyProgress()
    p.words['alpha'] = entry('review', '2026-07-23')
    p.words['bravo'] = entry('learning', '2026-07-22')
    expect(carriedOverCount(words, p, T)).toBe(2)
  })

  it('does not count a word due today, an unstarted entry, or an entry whose word is gone', () => {
    const p = emptyProgress()
    p.words['alpha'] = entry('review', T)
    p.words['bravo'] = { ...entry('review', '2026-07-01'), state: 'new' }
    p.words['deleted'] = entry('review', '2026-07-01')
    expect(carriedOverCount(words, p, T)).toBe(0)
  })

  it('buildQueue takes the live count off the new words when nothing is stored', () => {
    const { ws, p } = library(1)
    const q = buildQueue(ws, p, T)
    expect(q.carriedOver).toBe(1)
    expect(q.fresh).toHaveLength(2)
  })

  it('a stored count beats a lower live one — re-entering 复习 after clearing the overdue cards keeps the quota', () => {
    const { ws, p } = library(0)
    p.dailyStats[T] = { ...emptyStat(), carriedOver: 2 }
    const q = buildQueue(ws, p, T)
    expect(q.carriedOver).toBe(2)
    expect(q.fresh).toHaveLength(1)
  })

  it('a stored zero beats a live count: it is a real stamp, not a missing one', () => {
    const { ws, p } = library(3)
    p.dailyStats[T] = { ...emptyStat(), carriedOver: 0 }
    expect(buildQueue(ws, p, T).fresh).toHaveLength(3)
  })

  it('a malformed stored count falls back to the live count', () => {
    for (const bad of [-1, 1.5, NaN, '2']) {
      const { ws, p } = library(1)
      p.dailyStats[T] = { ...emptyStat(), carriedOver: bad as number }
      expect(buildQueue(ws, p, T).carriedOver).toBe(1)
    }
  })

  it('new words learned today come off the reduced quota', () => {
    const { ws, p } = library(1)
    p.dailyStats[T] = { ...emptyStat(), newLearned: 1, carriedOver: 1 }
    expect(buildQueue(ws, p, T).fresh).toHaveLength(1)
  })
})

/**
 * Only a session built on progress pulled that same day may stamp. A device
 * resumed from yesterday still sees yesterday's reviews done elsewhere as
 * overdue; with no other stamp that day to merge against, its overcount
 * would stand all day (final review of the carried-over change, 2026-11-04).
 */
describe('gradeSession', () => {
  const T = '2026-07-24'
  it('a session built after today\'s pull carries its count to grade', () => {
    expect(gradeSession(5, T, T)).toEqual({ day: T, carriedOver: 5 })
  })
  it('a session built on progress last pulled on an earlier day stamps nothing', () => {
    expect(gradeSession(5, T, '2026-07-23')).toBeUndefined()
  })
  it('a session built before the device has pulled at all stamps nothing', () => {
    expect(gradeSession(5, T, null)).toBeUndefined()
  })
})

/**
 * At most `reviewCap` review-phase words a day; the rest stay due, and a day
 * that holds any back learns no new words. See
 * docs/superpowers/specs/2026-11-05-daily-review-cap-design.md.
 */
describe('daily review cap', () => {
  const T = '2026-07-24'
  const NOW = new Date(2026, 6, 24, 9, 0, 0)
  const entry = (state: ProgressEntry['state'], due: string): ProgressEntry =>
    ({ state, ease: 2.5, intervalDays: state === 'review' ? 5 : 0, due, stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z' })
  /** `learning` learning words and `review` review words due today, `overdue` review words due yesterday, then `fresh` unstarted words. */
  const lib = (learning: number, review: number, fresh = 5, overdue = 0) => {
    const ids = (prefix: string, n: number) => [...Array(n).keys()].map(i => `${prefix}${String(i).padStart(2, '0')}`)
    const learningIds = ids('l', learning), reviewIds = ids('r', review), overdueIds = ids('o', overdue)
    const ws = [...learningIds, ...reviewIds, ...overdueIds, ...ids('f', fresh)].map(id => word(id))
    const p = emptyProgress()
    p.settings.newPerDay = 3
    for (const id of learningIds) p.words[id] = entry('learning', T)
    for (const id of reviewIds) p.words[id] = entry('review', T)
    for (const id of overdueIds) p.words[id] = entry('review', '2026-07-23')
    return { ws, p, learningIds }
  }

  it('serves the learning block whole and cuts the review block to the cap', () => {
    const { ws, p, learningIds } = lib(2, 6)
    p.settings.reviewCap = 4
    const q = buildQueue(ws, p, T)
    expect(q.due).toHaveLength(6)
    expect([...q.due.slice(0, 2)].sort()).toEqual(learningIds)
    expect(q.heldBack).toBe(2)
  })

  it('spent is reviewWords, else reviewPhase, else nothing', () => {
    expect(reviewWordsSpent({ ...emptyStat(), reviewWords: 3, reviewPhase: 5 })).toBe(3)
    expect(reviewWordsSpent({ ...emptyStat(), reviewPhase: 5 })).toBe(5)
    expect(reviewWordsSpent({ ...emptyStat() })).toBe(0)
    expect(reviewWordsSpent(undefined)).toBe(0)
    for (const bad of [-1, 1.5, NaN, '2']) {
      expect(reviewWordsSpent({ ...emptyStat(), reviewWords: bad as number, reviewPhase: 5 })).toBe(5)
    }
  })

  it('spent at or past the cap: no review words, the learning block still served', () => {
    for (const spent of [4, 9]) {
      const { ws, p, learningIds } = lib(2, 6)
      p.settings.reviewCap = 4
      p.dailyStats[T] = { ...emptyStat(), reviewWords: spent }
      const q = buildQueue(ws, p, T)
      expect([...q.due].sort()).toEqual(learningIds)
      expect(q.heldBack).toBe(6)
    }
  })

  it('anything held back empties the fresh list, whatever was carried over', () => {
    // 5 carried over alone would leave 7 of 12 new words; the cap (default 88)
    // holds 2 of the 90 review words back, so the day learns none.
    const { ws, p } = lib(0, 85, 20, 5)
    p.settings.newPerDay = 12
    const q = buildQueue(ws, p, T)
    expect(q.carriedOver).toBe(5)
    expect(q.due).toHaveLength(88)
    expect(q.heldBack).toBe(2)
    expect(q.fresh).toEqual([])
  })

  it('a cap at or above the review block changes nothing', () => {
    const { ws, p } = lib(0, 6)
    p.settings.reviewCap = 6
    const q = buildQueue(ws, p, T)
    expect(q.due).toHaveLength(6)
    expect(q.heldBack).toBe(0)
    expect(q.fresh).toHaveLength(3)
  })

  it('reviewCap absent or malformed reads as 88', () => {
    expect(reviewCap({ newPerDay: 3 })).toBe(88)
    expect(reviewCap({ newPerDay: 3, reviewCap: 20 })).toBe(20)
    for (const bad of [0, -5, 1.5, NaN, '20']) {
      expect(reviewCap({ newPerDay: 3, reviewCap: bad as number })).toBe(88)
    }
  })

  it('the cut is taken after spacing: a relative spaced past the cap waits instead of being served', () => {
    // resent and resentment share a stem and tie on usageScore, so the sort
    // puts them side by side; spacing (SESSION_SPACING_GAP 5) pushes
    // resentment past position 4. Cut first and spacing could not move it
    // out of a 4-word head, so it would be served beside resent.
    const ws: Word[] = ([['resent', 9], ['resentment', 9], ['carol', 8], ['delta', 7], ['echo', 6], ['foxtrot', 5], ['golf', 4]] as const)
      .map(([id, s]) => word(id, s))
    const build = (cap: number) => {
      const p = emptyProgress()
      p.settings.newPerDay = 0
      p.settings.reviewCap = cap
      for (const w of ws) p.words[w.id] = entry('review', T)
      return buildQueue(ws, p, T)
    }
    const capped = build(4)
    expect(capped.due).toEqual(build(999).due.slice(0, 4))
    expect(capped.due).not.toContain('resentment')
    expect(capped.heldBack).toBe(3)
  })

  /** Grade the first `k` served words "good" and count them, as grade() would. */
  const gradeFirst = (p: Progress, served: string[], k: number) => {
    for (const id of served.slice(0, k)) p.words[id] = gradeWord(p.words[id], 'good', NOW, () => 0.5)
    p.dailyStats[T] = { ...emptyStat(), reviewWords: k }
  }

  it('re-entry on a capped day: graded plus served stays the cap, and no new words come back', () => {
    const { ws, p } = lib(0, 6)
    p.settings.reviewCap = 4
    const before = buildQueue(ws, p, T)
    expect([before.due.length, before.heldBack, before.fresh.length]).toEqual([4, 2, 0])
    gradeFirst(p, before.due, 2)
    const after = buildQueue(ws, p, T)
    expect([after.due.length, after.heldBack, after.fresh.length]).toEqual([2, 2, 0])
    expect(after.due).toEqual(before.due.slice(2))
  })

  it('re-entry on an uncapped day: the new words stay', () => {
    const { ws, p } = lib(0, 4)
    p.settings.reviewCap = 4
    const before = buildQueue(ws, p, T)
    expect([before.due.length, before.heldBack, before.fresh.length]).toEqual([4, 0, 3])
    gradeFirst(p, before.due, 2)
    const after = buildQueue(ws, p, T)
    expect([after.due.length, after.heldBack, after.fresh.length]).toEqual([2, 0, 3])
  })
})
