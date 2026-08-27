import { describe, expect, it } from 'vitest'
import { advance, buildSessionQueue, currentId, dropCurrent, isDone, isHardConfirm, remaining } from './reviewQueue'
import { gradeWord } from '../lib/srs'
import type { ProgressEntry } from '../types'

const TODAY = '2026-07-25'
const noFuzz = () => 0.5

const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'learning', ease: 2.5, intervalDays: 0, due: TODAY,
  stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: `${TODAY}T00:00:00Z`, ...over,
})

describe('buildSessionQueue', () => {
  it('due words first, fresh words after, joined into the session queue', () => {
    const q = buildSessionQueue(['a', 'b'], ['c', 'd'])
    expect(q.ids).toEqual(['a', 'b', 'c', 'd'])
  })
  it('initial seen=0, total=queue length', () => {
    const q = buildSessionQueue(['a', 'b'], ['c'])
    expect(q.seen).toBe(0)
    expect(q.total).toBe(3)
  })
  it('both due and fresh empty → empty queue', () => {
    const q = buildSessionQueue([], [])
    expect(q.ids).toEqual([])
    expect(q.total).toBe(0)
  })
})

describe('currentId / isDone', () => {
  it('the current card is the head of the queue', () => {
    expect(currentId(buildSessionQueue(['x', 'y'], []))).toBe('x')
  })
  it('an empty queue has no current card, treated as done', () => {
    const q = buildSessionQueue([], [])
    expect(currentId(q)).toBeUndefined()
    expect(isDone(q)).toBe(true)
  })
  it('a non-empty queue is not done', () => {
    expect(isDone(buildSessionQueue(['x'], []))).toBe(false)
  })
})

describe('advance —— dequeuing and re-enqueuing', () => {
  it('graduated after grading (review state) → dequeued for good, seen+1, total unchanged', () => {
    const q = buildSessionQueue(['a', 'b'], [])
    const graduated = entry({ state: 'review', due: '2026-07-26' })
    const next = advance(q, 'a', graduated, TODAY)
    expect(next.ids).toEqual(['b'])
    expect(next.seen).toBe(1)
    expect(next.total).toBe(2)
  })
  it('still learning but due has moved to tomorrow (this intermediate state shouldn\'t occur before graduating, but guards against due>today anyway) → not reshuffled', () => {
    const q = buildSessionQueue(['a'], [])
    const next = advance(q, 'a', entry({ due: '2026-07-26' }), TODAY)
    expect(next.ids).toEqual([])
  })
  it('still learning and due is still today (learning step not finished) → reinserted at the tail, total+1', () => {
    const q = buildSessionQueue(['a', 'b'], [])
    const next = advance(q, 'a', entry({ due: TODAY }), TODAY)
    expect(next.ids).toEqual(['b', 'a'])
    expect(next.seen).toBe(1)
    expect(next.total).toBe(3)
  })
  it('entry is undefined (shouldn\'t happen, but guarded against) → treated as not reshuffled, dequeued directly', () => {
    const q = buildSessionQueue(['a'], [])
    const next = advance(q, 'a', undefined, TODAY)
    expect(next.ids).toEqual([])
    expect(next.seen).toBe(1)
  })
  it('re-enqueuing when it\'s the only card → the head of the queue is still itself (reappears immediately within the session)', () => {
    const q = buildSessionQueue(['a'], [])
    const next = advance(q, 'a', entry({ due: TODAY }), TODAY)
    expect(currentId(next)).toBe('a')
    expect(isDone(next)).toBe(false)
  })
})

describe('advance —— allowRecycle=false, the guard the practice drills depend on', () => {
  it('a learning card due today is NOT recycled when recycling is off', () => {
    // Practice grading writes nothing to the word on a correct answer, so
    // this card would otherwise satisfy the recycle test on every pass and
    // the session could never end.
    const q = buildSessionQueue(['a', 'b'], [])
    const stuck = entry({ state: 'learning', due: TODAY })
    expect(advance(q, 'a', stuck, TODAY, false).ids).toEqual(['b'])
    expect(advance(q, 'a', stuck, TODAY, true).ids).toEqual(['b', 'a'])
  })

  it('repeatedly grading the same unchanged card still drains the queue', () => {
    let q = buildSessionQueue(['a', 'b'], [])
    const unchanged = entry({ state: 'learning', due: TODAY })
    for (let i = 0; i < 5 && !isDone(q); i++) q = advance(q, currentId(q)!, unchanged, TODAY, false)
    expect(isDone(q)).toBe(true)
    expect(q.seen).toBe(2)
  })

  it('recycling stays on by default, so scheduled review is untouched', () => {
    const q = buildSessionQueue(['a'], [])
    expect(advance(q, 'a', entry({ state: 'learning', due: TODAY }), TODAY).ids).toEqual(['a'])
  })
})

describe('dropCurrent —— an entry disappears from the library (deleted on another device)', () => {
  it('drops the head of the queue, doesn\'t count toward seen, total decremented along with it', () => {
    const q = buildSessionQueue(['a', 'b', 'c'], [])
    const next = dropCurrent(q)
    expect(next.ids).toEqual(['b', 'c'])
    expect(next.seen).toBe(0)
    expect(next.total).toBe(2)
  })
  it('dropping the last card → the queue empties out, treated as done', () => {
    const q = buildSessionQueue(['a'], [])
    const next = dropCurrent(q)
    expect(next.ids).toEqual([])
    expect(isDone(next)).toBe(true)
    expect(next.total).toBe(0)
  })
  it('dropping one doesn\'t affect the rest of the words dequeuing/reshuffling normally', () => {
    let q = buildSessionQueue(['a', 'b'], [])
    q = dropCurrent(q) // a was deleted on another device
    expect(currentId(q)).toBe('b')
    const next = advance(q, 'b', entry({ state: 'review', due: '2026-07-26' }), TODAY)
    expect(isDone(next)).toBe(true)
    expect(next.seen).toBe(1)
    expect(next.total).toBe(1) // started with 2, dropped 1, leaving 1 — the denominator checks out
  })
})

describe('integration with real gradeWord: an "again" card reappears within the session, and the session can still eventually end', () => {
  const now = new Date(2026, 6, 25, 9, 0, 0) // 2026-07-25 local time, corresponding to TODAY

  it('a new word graduates after two "good" grades; a new word graduates immediately after one "easy"', () => {
    // alpha: graduates after a two-step learning process (good, good); bravo: a new word that graduates immediately with easy
    let q = buildSessionQueue([], ['alpha', 'bravo'])
    const progress: Record<string, ProgressEntry> = {}

    // Card 1: alpha, a new word
    expect(currentId(q)).toBe('alpha')
    progress['alpha'] = gradeWord(progress['alpha'], 'good', now, noFuzz)
    q = advance(q, 'alpha', progress['alpha'], TODAY)
    // Learning step not finished → reinserted at the tail
    expect(q.ids).toEqual(['bravo', 'alpha'])

    // Card 2: bravo, a new word, graduates immediately with easy
    expect(currentId(q)).toBe('bravo')
    progress['bravo'] = gradeWord(progress['bravo'], 'easy', now, noFuzz)
    q = advance(q, 'bravo', progress['bravo'], TODAY)
    expect(progress['bravo'].state).toBe('review')
    expect(q.ids).toEqual(['alpha']) // bravo has graduated, no longer appears

    // Card 3: alpha reappears, another "good" finishes the second step → graduates
    expect(currentId(q)).toBe('alpha')
    progress['alpha'] = gradeWord(progress['alpha'], 'good', now, noFuzz)
    q = advance(q, 'alpha', progress['alpha'], TODAY)
    expect(progress['alpha'].state).toBe('review')
    expect(q.ids).toEqual([])
    expect(isDone(q)).toBe(true)
    expect(q.seen).toBe(3)   // graded 3 times
    expect(q.total).toBe(3)  // 2 initial cards + 1 reappearance insertion
  })

  it('repeatedly grading "again" keeps re-enqueuing (never loses the card), but as soon as the user picks a different grade once, the session can end; the progress denominator grows honestly with reappearances', () => {
    let q = buildSessionQueue(['carol'], [])
    let carolEntry: ProgressEntry | undefined
    let againCount = 0

    // Simulates clicking "again" 5 times in a row — each time it should reappear in the queue, rather than being dropped or getting stuck
    for (let i = 0; i < 5; i++) {
      expect(currentId(q)).toBe('carol') // it's up every time (it's the only card in the queue)
      carolEntry = gradeWord(carolEntry, 'again', now, noFuzz)
      q = advance(q, 'carol', carolEntry, TODAY)
      againCount++
      expect(isDone(q)).toBe(false)   // not done yet
      expect(q.total).toBe(1 + againCount) // the denominator grows honestly with each "again", so x/y never looks stuck
      expect(q.seen).toBe(againCount)
    }

    // The user finally grades "easy", graduating immediately, and the session can end right away — proving this isn't an infinite loop, just expected behavior
    carolEntry = gradeWord(carolEntry, 'easy', now, noFuzz)
    q = advance(q, 'carol', carolEntry, TODAY)
    expect(isDone(q)).toBe(true)
    expect(carolEntry.state).toBe('review')
  })
})

describe('remaining', () => {
  it('equals the number of ungraded cards still in the queue', () => {
    const q = buildSessionQueue(['a', 'b'], ['c'])
    expect(remaining(q)).toBe(3)
  })
  it('drops by one for every card graded', () => {
    const q = advance(buildSessionQueue(['a'], ['b']), 'a', undefined, '2026-07-25')
    expect(remaining(q)).toBe(1)
  })
  it('learning-step reappearance: the total is unchanged, remaining doesn\'t drop — it just falls more slowly rather than growing', () => {
    const q0 = buildSessionQueue([], ['a', 'b'])
    const learning: ProgressEntry = {
      state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-25',
      stepIndex: 1, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z',
    }
    const q1 = advance(q0, 'a', learning, '2026-07-25')
    expect(remaining(q0)).toBe(2)
    expect(remaining(q1)).toBe(2) // a was pushed back to the tail: still two cards left to see
  })
  it('is 0 once emptied', () => {
    const q = advance(buildSessionQueue([], ['a']), 'a', undefined, '2026-07-25')
    expect(remaining(q)).toBe(0)
    expect(isDone(q)).toBe(true)
  })
  it('dropCurrent decrements remaining by one', () => {
    const q = dropCurrent(buildSessionQueue(['a', 'b'], []))
    expect(remaining(q)).toBe(1)
  })
})

describe('advance —— 困难 brings a review-phase card back', () => {
  /**
   * User-reported: only 重来 actually re-shows a card, and it does so as a
   * side effect of relapsing the word to `learning`. 困难 keeps the word in
   * `review` with a future `due`, so it could never satisfy the recycle
   * condition — and it lengthens the interval on top of that. When a card
   * is re-shown inside a session was never the scheduler's decision, so
   * this is fixed here and srs.ts is untouched.
   *
   * See docs/superpowers/specs/2026-08-25-hard-requeue-design.md.
   */
  const reviewed = (over: Partial<ProgressEntry> = {}): ProgressEntry =>
    entry({ state: 'review', intervalDays: 12, due: '2026-08-06', ...over })

  it('goes to the tail of the whole queue, behind the fresh words', () => {
    const q = buildSessionQueue(['a', 'b'], ['c'])
    const next = advance(q, 'a', reviewed(), TODAY, true, 'hard')
    expect(next.ids).toEqual(['b', 'c', 'a'])
    expect(next.total).toBe(4)
  })

  it('良好 and 简单 dequeue it for good', () => {
    const q = buildSessionQueue(['a', 'b'], [])
    expect(advance(q, 'a', reviewed(), TODAY, true, 'good').ids).toEqual(['b'])
    expect(advance(q, 'a', reviewed(), TODAY, true, 'easy').ids).toEqual(['b'])
  })

  it('re-queues once per card per session, never twice', () => {
    // Uncapped, each extra showing could be graded 困难 again — and every
    // press runs the review-phase branch again, interval x1.2 over a "+1
    // day" floor with ease -0.15. Before this rule a session could apply
    // that once, because the card never came back; compounding it without
    // limit would be a harm this change introduced rather than inherited.
    const first = advance(buildSessionQueue(['a', 'b'], []), 'a', reviewed(), TODAY, true, 'hard')
    expect(first.ids).toEqual(['b', 'a'])
    const second = advance({ ...first, ids: ['a'] }, 'a', reviewed(), TODAY, true, 'hard')
    expect(second.ids).toEqual([])
    expect(second.total).toBe(first.total)
  })

  it('a learning-phase 困难 still recycles by the old rule, and keeps its allowance', () => {
    // srs.ts sets due = today and leaves state at learning, so the original
    // condition already covers it. It must not also spend the once-per-
    // session allowance, or the word would stop recycling mid-learning.
    const q = buildSessionQueue(['a', 'b'], [])
    const next = advance(q, 'a', entry({ state: 'learning', due: TODAY }), TODAY, true, 'hard')
    expect(next.ids).toEqual(['b', 'a'])
    expect(next.hardRecycled).toEqual([])
  })

  it('allowRecycle=false suppresses it, like every other recycle', () => {
    const q = buildSessionQueue(['a', 'b'], [])
    expect(advance(q, 'a', reviewed(), TODAY, false, 'hard').ids).toEqual(['b'])
  })

  it('the real scheduler output for 困难 is a card this rule has to catch', () => {
    // Guards the premise rather than the code: if gradeWord ever stopped
    // leaving a 困难-graded review word in `review` with a future due, the
    // rule above would be solving a problem that no longer exists.
    const graded = gradeWord(entry({ state: 'review', intervalDays: 12, due: '2026-08-06' }), 'hard', new Date(`${TODAY}T12:00:00Z`), noFuzz)
    expect(graded.state).toBe('review')
    expect(graded.due > TODAY).toBe(true)
  })
})

describe('isHardConfirm —— the second showing bought by 困难 is confirm-only', () => {
  /**
   * User-reported two days after the requeue shipped: the re-shown card's
   * previews were computed over the entry the first 困难 press had already
   * committed, and grading it stacked a second full gradeWord in the same
   * minute — 困难-then-良好 scheduled a word *further out* than plain 良好
   * (28 vs 25 days on a 10-day word). The second showing therefore grades
   * nothing: 重来 stays (a failed second look is a genuine relapse), the
   * only other action dismisses via a plain advance() with no grade.
   * See docs/superpowers/specs/2026-08-27-hard-requeue-confirm-design.md.
   */
  const now = new Date(2026, 6, 25, 9, 0, 0) // 2026-07-25 local time, corresponding to TODAY
  const reviewed = (over: Partial<ProgressEntry> = {}): ProgressEntry =>
    entry({ state: 'review', intervalDays: 12, due: '2026-08-06', ...over })

  /** The queue state at the moment the hard-recycled card reaches the head again, plus the entry its 困难 press committed. */
  const atSecondShowing = () => {
    const q0 = buildSessionQueue(['a', 'b'], [])
    const committed = gradeWord(reviewed(), 'hard', now, noFuzz)
    const q1 = advance(q0, 'a', committed, TODAY, true, 'hard')
    const q2 = advance(q1, 'b', gradeWord(reviewed(), 'good', now, noFuzz), TODAY, true, 'good')
    return { q: q2, committed }
  }

  it('false on the first showing, before any 困难 press', () => {
    const q = buildSessionQueue(['a'], [])
    expect(isHardConfirm(q, 'a', reviewed())).toBe(false)
  })

  it('true when the hard-recycled card reaches the head again', () => {
    const { q, committed } = atSecondShowing()
    expect(currentId(q)).toBe('a')
    expect(isHardConfirm(q, 'a', committed)).toBe(true)
  })

  it('a confirm dismissal is a plain advance with no grade: dequeued for good', () => {
    const { q, committed } = atSecondShowing()
    const next = advance(q, 'a', committed, TODAY, true)
    expect(isDone(next)).toBe(true)
    expect(next.seen).toBe(3)
  })

  it('重来 on the confirm showing relapses to learning, and the learning steps grade normally from then on', () => {
    // The state check is what makes this work: after the relapse the id is
    // still in hardRecycled, and membership alone would mark every
    // learning-step showing confirm-only for the rest of the session.
    const { q, committed } = atSecondShowing()
    const relapsed = gradeWord(committed, 'again', now, noFuzz)
    expect(relapsed.state).toBe('learning')
    const next = advance(q, 'a', relapsed, TODAY, true, 'again')
    expect(currentId(next)).toBe('a') // recycled through the learning rule, not dequeued
    expect(isHardConfirm(next, 'a', relapsed)).toBe(false)
  })

  it('undefined id or entry → false', () => {
    const { q, committed } = atSecondShowing()
    expect(isHardConfirm(q, undefined, committed)).toBe(false)
    expect(isHardConfirm(q, 'a', undefined)).toBe(false)
  })
})
