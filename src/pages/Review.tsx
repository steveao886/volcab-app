import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { isEditableTarget } from '../lib/keys'
import { buildConsolidateQueue, buildLapseQueue, buildQueue, CONSOLIDATE_DELAY_HOURS, rankStrugglingWords } from '../lib/queue'
import { isSoundEnabled, playGrade, playSessionDone } from '../lib/sound'
import { storage } from '../lib/storage'
import { todayStr } from '../lib/srs'
import { preparePronunciation, pronounce } from '../lib/pronounce'
import { ReviewCardBack } from './ReviewCard'
import { advance, buildSessionQueue, currentId, dropCurrent, isDone, remaining } from './reviewQueue'
import type { SessionQueue } from './reviewQueue'
import { useApp } from '../state/store'
import type { Grade } from '../types'
import './Review.css'

/* Keyboard shortcuts only take over the space/number keys when focus
   "isn't inside a text input control" — this check shares one
   implementation with the quiz page's option shortcuts, see lib/keys.ts. */

const GRADE_KEYS: Record<string, Grade> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }

/** Which local marker records "this drill is done for today"; the scheduled review has none, because finishing it is already written into the word data. */
const DONE_KEY = { lapses: 'lapseDrilledOn', consolidate: 'consolidatedOn' } as const

type ReviewMode = 'due' | 'lapses' | 'consolidate'

const doneToday = (mode: ReviewMode, today: string): boolean =>
  mode === 'due' ? false : storage.get<string>(DONE_KEY[mode]) === today

const markDoneToday = (mode: ReviewMode, today: string): void => {
  if (mode !== 'due') storage.set(DONE_KEY[mode], today)
}

/** Fallback timeout (ms) for when pendingRef gets stuck — see the note on the advance effect. */
const PENDING_STUCK_TIMEOUT_MS = 2000

/**
 * Task 17 implementation.
 *
 * The session queue is built once on mount via buildQueue() (see the
 * useState lazy initial value); after that, it's only ever advanced by
 * reviewQueue.ts's pure functions — grade() mutates global progress, and
 * recomputing the queue live would reshuffle it right under the user's
 * eyes, so buildQueue() must never be called again mid-session.
 *
 * The "flipped" state isn't synced via useEffect: it's derived directly at
 * render time from three things — (the current card's id, that word's
 * progress state, the user's manual flip for *this specific card*). The
 * manual flip records {id, value}; the moment the head of the queue
 * changes to a different word, the id no longer matches, so it naturally
 * falls back to the "is this a new word" default — no separate reset
 * needed.
 */
export function Review() {
  const { words, progress, grade, recordLapseDrill, recordConsolidation, deleteWords } = useApp()
  const [today] = useState(() => todayStr(new Date()))
  // ?mode= swaps which batch the session is built from — lapses (words you
  // keep forgetting) or consolidate (today's new words, a few hours on).
  // Everything else about the page (flipping, grading, learning-step
  // reappearance, deleting a word on the spot) is identical, which is why
  // these are query params rather than separate routes.
  //
  // **Only read once, on mount**: same reasoning as buildQueue — switching
  // modes mid-session would reshuffle the queue right under the user's
  // eyes. To switch modes, leave and re-enter.
  const [searchParams] = useSearchParams()
  const [mode] = useState<'due' | 'lapses' | 'consolidate'>(() => {
    const m = searchParams.get('mode')
    return m === 'lapses' ? 'lapses' : m === 'consolidate' ? 'consolidate' : 'due'
  })
  const lapseMode = mode === 'lapses'
  const consolidateMode = mode === 'consolidate'
  // Both drills are practice: they never advance the schedule, so nothing
  // in the word data records that today's pass happened. The marker is
  // local (see lib/storage.ts for why it can't be synced), and it's read
  // once here so that finishing a session doesn't blank the cards out from
  // under the "done" screen.
  const [alreadyDone] = useState(() => doneToday(mode, today))
  const [queue, setQueue] = useState<SessionQueue>(() => {
    if (lapseMode) {
      return buildSessionQueue(alreadyDone ? [] : buildLapseQueue(words, progress, today), [])
    }
    if (consolidateMode) {
      return buildSessionQueue(alreadyDone ? [] : buildConsolidateQueue(words, progress, new Date(), today), [])
    }
    const q = buildQueue(words, progress, today)
    return buildSessionQueue(q.due, q.fresh)
  })
  const [manualFlip, setManualFlip] = useState<{ id: string; value: boolean } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // After grading, the committed result needs to be "read back" before
  // deciding whether to push the card back to the tail of the queue (see
  // the comment on reviewQueue.advance) — this ref just tracks which card
  // is being waited on during that read, to keep the same card from being
  // graded twice by a double click.
  const pendingRef = useRef<string | undefined>(undefined)
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The session-complete sound must only ever play once: while finished
  // stays true, this component can re-render many times for unrelated
  // reasons (e.g. a sync tick), so "play whenever finished is true" can't
  // be used as its own dedup condition.
  const sessionDonePlayedRef = useRef(false)

  const soundEnabled = isSoundEnabled(progress.settings)

  const curId = currentId(queue)
  const curWord = curId === undefined ? undefined : words.find((w) => w.id === curId)
  const curEntry = curId === undefined ? undefined : progress.words[curId]
  const isNewCard = curId !== undefined && (!curEntry || curEntry.state === 'new')
  const flipped = curId !== undefined && manualFlip?.id === curId ? manualFlip.value : isNewCard
  const finished = isDone(queue)

  // Warm the recording as soon as the card is on screen, so the speak tap
  // plays a prepared file synchronously — the iOS gesture rule in
  // lib/pronounce.ts is the reason this can't wait until the tap itself.
  useEffect(() => {
    if (curWord !== undefined) preparePronunciation(curWord.headword)
  }, [curWord])

  const toggleFlip = useCallback(() => {
    if (curId === undefined) return
    setManualFlip({ id: curId, value: !flipped })
  }, [curId, flipped])

  const handleGrade = useCallback(
    (g: Grade) => {
      if (pendingRef.current !== undefined) return // Previous grade hasn't landed yet, ignore the repeat click
      if (curId === undefined || !flipped) return // Grading before flipping doesn't mean anything
      // Played synchronously within the click's call stack: iOS requires
      // the AudioContext's creation/resume to happen inside a user
      // gesture, and this is the single, earliest point where sound plays
      // for a grade (see lib/sound.ts).
      playGrade(g, soundEnabled)
      pendingRef.current = curId
      // Fallback: the effect below relies on the cross-module contract
      // that "progress is guaranteed to become a new reference once
      // grade() commits" (see the note on that effect). If that contract
      // is ever broken, pendingRef would stay stuck forever, silently
      // disabling grading for the rest of this session with no error at
      // all — so if it isn't resolved within 2s, unlock it and leave a
      // trace.
      pendingTimeoutRef.current = setTimeout(() => {
        if (pendingRef.current === curId) {
          console.error(
            `[Review] No new progress arrived within ${PENDING_STUCK_TIMEOUT_MS}ms of grading "${curId}". ` +
              'Force-releasing pendingRef, otherwise the grade buttons stay dead for the rest of this session. ' +
              "This usually means store.tsx's grade() did not produce a new progress reference as expected.",
          )
          pendingRef.current = undefined
        }
      }, PENDING_STUCK_TIMEOUT_MS)
      // Lapse mode is a drill, not a review: it deliberately ignores due
      // dates, so putting it through grade() would let one afternoon of
      // practice multiply a word's interval several times over and push
      // the hardest words furthest into the future. See recordLapseDrill.
      if (lapseMode) recordLapseDrill(curId, g)
      else if (consolidateMode) recordConsolidation(curId, g)
      else grade(curId, g)
    },
    [curId, flipped, grade, recordLapseDrill, recordConsolidation, lapseMode, consolidateMode, soundEnabled],
  )

  // Review session complete sound: fires exactly once, at the moment
  // finished transitions from false to true. queue.total === 0 (there was
  // never anything to review, see the "nothing due" branch below) doesn't
  // count as completing a session, so this sound doesn't play — no card
  // was ever seen, so there's nothing to call "complete".
  useEffect(() => {
    if (finished && queue.total > 0 && !sessionDonePlayedRef.current) {
      sessionDonePlayedRef.current = true
      playSessionDone(soundEnabled)
      // Recorded on completion rather than on the first grade: abandoning
      // a drill halfway shouldn't cost you the rest of it for the day.
      markDoneToday(mode, today)
    }
  }, [finished, queue.total, soundEnabled, mode, today])

  // grade() commits synchronously but renders asynchronously: the progress
  // available right now is still the old one, so we have to wait for the
  // next render carrying the new progress, and only then read the real
  // committed result back out of it to advance the queue.
  //
  // Whether this effect ever fires depends on an implicit cross-module
  // contract: store.tsx's grade() always produces a brand-new progress
  // object via the spread operator (see commitProgress/update in
  // store.tsx), so the [progress] dependency guarantees this reruns after
  // every grade. store.tsx is a frozen file for this task, and that
  // contract has no compile-time guarantee — the timeout in handleGrade
  // above exists specifically to guard against it being silently broken.
  useEffect(() => {
    const pendingId = pendingRef.current
    if (pendingId === undefined) return
    pendingRef.current = undefined
    if (pendingTimeoutRef.current !== undefined) {
      clearTimeout(pendingTimeoutRef.current)
      pendingTimeoutRef.current = undefined
    }
    const entry = progress.words[pendingId]
    setQueue((q) => advance(q, pendingId, entry, today, mode === 'due'))
    // The head of the queue has moved on to "the next showing" — even if
    // the card reinserted at the tail happens to have the same id
    // (reappearing within this session), the manual flip record must
    // still be cleared: otherwise curId===manualFlip.id would mistake it
    // for the previous showing, and a reappearing card that should
    // require the user to flip it again would show up already flipped to
    // the answer side.
    setManualFlip(null)
  }, [progress, today, mode])

  // Clears the fallback timer on unmount, so it doesn't reach for a ref that no longer exists after the page is gone.
  useEffect(
    () => () => {
      if (pendingTimeoutRef.current !== undefined) clearTimeout(pendingTimeoutRef.current)
    },
    [],
  )

  // The word at the head of the queue can no longer be found in words
  // (deleted from another device, sync landed mid-session) — it can't be
  // graded and there's no card to render for it, so all that's left is to
  // drop it and move on to the next one in the queue. This only happens
  // once grading has settled (pendingRef cleared), to avoid mutating the
  // queue at the same time as the effect above.
  useEffect(() => {
    if (pendingRef.current !== undefined) return
    if (curId !== undefined && curWord === undefined) {
      setQueue((q) => dropCurrent(q))
    }
  }, [curId, curWord])

  function handleDelete() {
    if (curWord === undefined || deleting) return
    setDeleting(true)
    // The same tradeoff as WordDetail: the local delete is already the
    // authoritative result, without waiting for the network push to
    // finish. It also needs to be dropped from the session queue here,
    // otherwise the head of the queue would still point at a word that no
    // longer exists.
    void deleteWords([curWord.id]).finally(() => setDeleting(false))
    setQueue((q) => dropCurrent(q))
    setConfirmDelete(false)
  }

  const handleCardKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Only handles the case where the card itself has focus; a child
      // element's (the speak button's) keypress is left to its own native
      // handling, otherwise a Space/Enter bubbling up from the speak
      // button would get handled a second time here.
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation() // Stops this same event from bubbling up to the global listener on window, avoiding a double flip
        toggleFlip()
      }
    },
    [toggleFlip],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (curId === undefined || isEditableTarget(document.activeElement)) return
      if (e.key === ' ' || e.code === 'Space') {
        // Only takes over Space as the flip shortcut when "nothing at all
        // has focus" (activeElement===body). When the card itself has
        // focus, its own onKeyDown handles it (see handleCardKeyDown);
        // when focus is on a native control like the speak button / grade
        // buttons / back link, Space must be left to their own default
        // behavior — otherwise you'd get bugs like "Tab to the speak
        // button, press Space, and the card flips instead of the
        // pronunciation replaying", stealing key semantics from a focused
        // control.
        if (document.activeElement !== document.body) return
        e.preventDefault() // Space scrolls the page by default, which must be blocked
        toggleFlip()
        return
      }
      if (!flipped) return
      const g = GRADE_KEYS[e.key]
      if (g) {
        e.preventDefault()
        handleGrade(g)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [curId, flipped, toggleFlip, handleGrade])

  const reviewedToday = progress.dailyStats[today]?.reviewed ?? 0
  // Only asked when the drill comes up empty, but the hook can't be
  // conditional; the filter is cheap next to the card render either way.
  const hasStrugglingWords = useMemo(
    () => (lapseMode ? rankStrugglingWords(words, progress).length > 0 : false),
    [lapseMode, words, progress],
  )

  const eyebrow = consolidateMode ? 'Consolidate' : lapseMode ? 'Lapses' : 'Review'
  const title = consolidateMode ? '今日巩固' : lapseMode ? '顽固词' : '复习'

  if (finished) {
    const empty = queue.total === 0
    // An empty drill has two completely different causes, and telling them
    // apart matters: "you have no stubborn words" is congratulations,
    // while "you already did them today" is a schedule. Saying the first
    // when the second is true would quietly claim the list had been
    // cleared for good. `alreadyDone` is read once on mount, so it still
    // reports the state the session *started* in.
    const clearedForToday = empty && (alreadyDone || (lapseMode && hasStrugglingWords))
    return (
      <Page eyebrow={eyebrow} title={title} back="/">
        <div className="review-done">
          <p className="review-done__label">
            {consolidateMode
              ? empty ? (clearedForToday ? '今天已巩固' : '暂无需要巩固的词') : '巩固完成'
              : lapseMode
                ? empty ? (clearedForToday ? '今天已练完' : '暂无顽固词') : '顽固词已清完'
                : empty ? '暂无待复习' : '复习完成'}
          </p>
          <p className="review-done__count">
            今天已复习 <span className="num">{reviewedToday}</span> 个词
          </p>
          <p className="muted">
            {consolidateMode
              ? empty
                ? clearedForToday
                  ? '今天的新词已经复盘过一遍了,明天它们会正常到期。'
                  : `今天学的新词要过 ${CONSOLIDATE_DELAY_HOURS} 小时才值得再看一遍,先去做点别的。`
                : '刚学的词隔几小时再想起来一次,才是真正记住的那一次。'
              : lapseMode
                ? empty
                  ? clearedForToday
                    ? '顽固词每天练一遍就够了,明天再来。'
                    : '眼下没有记不牢的词 —— 这是好事。'
                  : '这一批错得最多的词都过了一遍。'
                : empty
                  ? '暂时没有到期或新词需要复习。'
                  : '今日复习已全部完成,休息一下吧。'}
          </p>
          <Link to="/" className="btn btn--primary btn--lg">
            返回今日
          </Link>
        </div>
      </Page>
    )
  }

  if (!curWord) {
    // curId exists (the queue isn't empty) but the word can no longer be
    // found in words — the effect above will drop it from the queue and
    // advance to the next one; this is just that transitional state
    // (usually gone within one frame), and must neither try to render the
    // card (would crash on curWord being undefined) nor be treated as
    // "session complete".
    return (
      <Page eyebrow={eyebrow} title={title} back="/">
        <p className="muted">正在跳过一个已被移除的词条…</p>
      </Page>
    )
  }

  return (
    <Page eyebrow={eyebrow} title={title} back="/">
      <div className="review-progress">
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={queue.total}
          aria-valuenow={queue.seen}
          aria-valuetext={`还剩 ${remaining(queue)} 张`}
        >
          <div className="progress__fill" style={{ width: `${(queue.seen / queue.total) * 100}%` }} />
        </div>
        <p className="num muted review-progress__count">还剩 {remaining(queue)} 张</p>
      </div>

      {/* The drill reuses the four-way grade UI but no longer schedules
          with it, and a control that silently does less than it looks
          like it does is worse than no control. Say so once, on the page
          where it's true. */}
      {(lapseMode || consolidateMode) && (
        <p className="faint review-drill-note">这是练习:答错会把词提前到今天重新排队,答对不改变复习间隔。</p>
      )}

      {/* Above the card, not below it. It was a sticky bar under the card,
          and with a long back the user still reported scrolling to grade —
          and the bar sat overlaying the tail of the card's own content. Up
          here it is always in the same place, visible from the moment the
          card flips, and covers nothing. The 1-4 keys are unchanged. */}
      <div className="review-actions">
        {flipped ? (
          <div className="review-grades">
            <Button variant="grade-again" onClick={() => handleGrade('again')}>
              重来<span className="review-grade__key">1</span>
            </Button>
            <Button variant="grade-hard" onClick={() => handleGrade('hard')}>
              困难<span className="review-grade__key">2</span>
            </Button>
            <Button variant="grade-good" onClick={() => handleGrade('good')}>
              良好<span className="review-grade__key">3</span>
            </Button>
            <Button variant="grade-easy" onClick={() => handleGrade('easy')}>
              简单<span className="review-grade__key">4</span>
            </Button>
          </div>
        ) : (
          <p className="muted review-hint">点击卡片或按空格键翻面</p>
        )}
      </div>

      <Card
        className={`review-card card--interactive ${flipped ? 'review-card--back' : 'review-card--front'} ${isNewCard ? 'review-card--badge' : ''}`}
        onClick={toggleFlip}
        role="button"
        tabIndex={0}
        aria-expanded={flipped}
        aria-label={flipped ? `收起 ${curWord.headword} 的释义` : `翻面查看 ${curWord.headword} 的释义`}
        onKeyDown={handleCardKeyDown}
      >
        {isNewCard && (
          <Badge tone="accent" className="review-card__badge">
            新词
          </Badge>
        )}
        <div className="review-card__head">
          <p className="word word--xl" lang="en">
            {curWord.headword}
          </p>
          <button
            type="button"
            className="review-card__speak"
            aria-label="发音"
            onClick={(e) => {
              e.stopPropagation() // Stops clicking to speak from also flipping the card
              pronounce(curWord.headword)
            }}
          >
            <Icon name="speak" />
          </button>
        </div>
        {flipped && <ReviewCardBack word={curWord} />}
      </Card>

      {flipped && (
        <div className="review-cull">
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            删除这个词
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        titleId="review-delete-title"
        title={`删除「${curWord?.headword ?? ''}」?`}
        body="这个词条以及它的学习进度(状态、复习次数、失误次数等)会一并删除,且无法恢复。"
        confirmLabel="确认删除"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </Page>
  )
}
