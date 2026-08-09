import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { isEditableTarget } from '../lib/keys'
import { PRACTICE_DRAW_SIZE, samplePractice } from '../lib/practice'
import { preparePronunciation, pronounce } from '../lib/pronounce'
import { isSoundEnabled, playGrade, playSessionDone } from '../lib/sound'
import { filterToParams, filterWords, paramsToFilter } from './libraryFilter'
import { ReviewCardBack } from './ReviewCard'
import { useApp } from '../state/store'
import type { Word } from '../types'
// The card face is literally the review card — same headword block, same
// speak button, and ReviewCardBack emits .review-back and everything under
// it. Review.css has to be loaded for this page to render correctly even
// when it is opened directly, which on an installed PWA is the normal way
// back into a page after a reload. Vite dedupes the second import.
import './Review.css'
import './Practice.css'

/**
 * Free practice: a slice of the library, shuffled, twenty at a time.
 *
 * Not a mode of Review.tsx, though it shares that page's card. The two
 * `?mode=` drills there are the review page with a different queue — same
 * four-way grading, same practiceGrade write path, same daily-completion
 * marker. This grades two ways, writes strictly less (see recordPractice),
 * draws from a filter rather than the scheduler, and has no notion of being
 * finished for the day. ReviewCardBack is exported, so the expensive half
 * is shared at the component boundary instead.
 *
 * The word set arrives as **filter criteria, not ids**: `status=review`
 * alone is around 300 words, far past what a query string should carry, and
 * router location state would not survive the reload that is the normal way
 * back into an installed PWA. filterWords is the same pure function the
 * library page calls, with the same options object, so the two always agree
 * about what the slice contains.
 */
export function Practice() {
  const { words, progress, recordPractice } = useApp()

  // **Read once, on mount**, the same reasoning as Review.tsx's mode: these
  // three values decide the pool, and letting them change mid-session would
  // redraw the deck under the user's hands.
  const [searchParams] = useSearchParams()
  const [filter] = useState(() => paramsToFilter(searchParams))

  // Back goes to the library *as it was left*, not to all 504 words. The
  // library keeps its filter in the URL under these same three parameter
  // names, so re-encoding what this page was given lands on the exact list
  // the 练这 N 个 button was pressed from.
  const backTo = useMemo(() => {
    const qs = filterToParams(filter)
    return qs === '' ? '/library' : `/library?${qs}`
  }, [filter])

  // progress is part of the filter (the status chip reads learning state),
  // and every sync tick hands back a new object — so this has to be memoized
  // or a background push would re-filter the whole library. Same precedent
  // as Library.tsx's own `filtered`.
  const pool = useMemo(() => filterWords(words, progress, filter), [words, progress, filter])

  // The deck holds Word objects rather than ids, unlike Review.tsx's queue.
  // A word deleted from another device mid-session then just stays on its
  // card — the object is already in hand — and grading it is a no-op because
  // recordPractice finds no progress entry. That removes the whole
  // "the head of the queue points at a word that no longer exists"
  // transitional state the review page has to render around.
  const [deck, setDeck] = useState<Word[]>(() => samplePractice(pool))
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const soundEnabled = isSoundEnabled(progress.settings)
  const cur = deck[idx]
  const finished = idx >= deck.length

  // Everything drawn so far, this deck included — the exclusion set for the
  // next draw, and the basis for knowing whether to offer one at all.
  const drawn = useMemo(() => {
    const s = new Set(seen)
    for (const w of deck) s.add(w.id)
    return s
  }, [seen, deck])
  const hasMore = useMemo(() => pool.some(w => !drawn.has(w.id)), [pool, drawn])

  // Warm the recording while the card is on screen so the speak tap plays a
  // prepared file synchronously — the iOS gesture rule in lib/pronounce.ts
  // is why this can't wait for the tap.
  useEffect(() => {
    if (cur !== undefined) preparePronunciation(cur.headword)
  }, [cur])

  // Fires once per completed deck. A deck that was empty from the start
  // (a bookmarked filter that now matches nothing) isn't a session anyone
  // finished, so it gets no sound — same judgement as Review.tsx.
  useEffect(() => {
    if (finished && deck.length > 0) playSessionDone(soundEnabled)
  }, [finished, deck.length, soundEnabled])

  const toggleFlip = useCallback(() => setFlipped(f => !f), [])

  const answer = useCallback(
    (correct: boolean) => {
      if (cur === undefined || !flipped) return
      // Played inside the click's own call stack: iOS requires the
      // AudioContext to be created/resumed within a user gesture, and this
      // is the earliest point where sound plays for an answer.
      playGrade(correct ? 'good' : 'again', soundEnabled)
      recordPractice(cur.id, correct)
      setIdx(i => i + 1)
      setFlipped(false)
    },
    [cur, flipped, recordPractice, soundEnabled],
  )

  const redraw = useCallback(() => {
    setSeen(drawn)
    setDeck(samplePractice(pool, PRACTICE_DRAW_SIZE, { exclude: drawn }))
    setIdx(0)
    setFlipped(false)
  }, [drawn, pool])

  const handleCardKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // A keypress from a child (the speak button) is left to its own native
      // handling; without this the event would bubble here and flip too.
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        toggleFlip()
      }
    },
    [toggleFlip],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (cur === undefined || isEditableTarget(document.activeElement)) return
      if (e.key === ' ' || e.code === 'Space') {
        // Space is only taken over as the flip shortcut when nothing at all
        // has focus. With focus on the card its own handler runs; with focus
        // on a real control (speak, the answer buttons, the back link) Space
        // belongs to that control — see Review.tsx for the bug this prevents.
        if (document.activeElement !== document.body) return
        e.preventDefault()
        toggleFlip()
        return
      }
      if (!flipped) return
      if (e.key === '1') { e.preventDefault(); answer(false) }
      if (e.key === '2') { e.preventDefault(); answer(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cur, flipped, toggleFlip, answer])

  if (finished) {
    const neverStarted = deck.length === 0 && seen.size === 0
    return (
      <Page eyebrow="Practice" title="自由练习" back={backTo}>
        <div className="review-done">
          <p className="review-done__label">{neverStarted ? '没有可练的词' : '这一批练完了'}</p>
          <p className="muted">
            {neverStarted
              ? '这组筛选条件下没有词条,回词库换个条件试试。'
              : hasMore
                ? '想接着练就再抽一批,不想练随时可以走 —— 这里不记进度。'
                : '这组筛选条件下的词都过了一遍。'}
          </p>
          {hasMore && (
            <Button variant="primary" size="lg" onClick={redraw}>
              再来一批
            </Button>
          )}
          <Link to={backTo} className="btn btn--secondary btn--lg">
            返回词库
          </Link>
        </div>
      </Page>
    )
  }

  return (
    <Page eyebrow="Practice" title="自由练习" back={backTo}>
      <div className="review-progress">
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={deck.length}
          aria-valuenow={idx}
          aria-valuetext={`还剩 ${deck.length - idx} 张`}
        >
          <div className="progress__fill" style={{ width: `${(idx / deck.length) * 100}%` }} />
        </div>
        <p className="num muted review-progress__count">还剩 {deck.length - idx} 张</p>
      </div>

      {/* Says what the page does *not* do, which is the whole reason it
          exists. Sits above the card so it is read before the first answer
          rather than discovered after — same placement decision as the
          review page's drill note. */}
      <p className="faint review-drill-note">
        随便练:答错的词会进顽固词队列,但不影响复习计划,也不计入今日复习。
      </p>

      {/* Above the card, like the review grades: always in the same place,
          visible the moment the card flips, and covering nothing. */}
      <div className="review-actions">
        {flipped ? (
          <div className="practice-answers">
            <Button variant="grade-again" onClick={() => answer(false)}>
              <span className="review-grade__label">
                不认识<span className="review-grade__key">1</span>
              </span>
            </Button>
            <Button variant="grade-good" onClick={() => answer(true)}>
              <span className="review-grade__label">
                认识<span className="review-grade__key">2</span>
              </span>
            </Button>
          </div>
        ) : (
          <p className="muted review-hint">点击卡片或按空格键翻面</p>
        )}
      </div>

      <Card
        className={`review-card card--interactive ${flipped ? 'review-card--back' : 'review-card--front'}`}
        onClick={toggleFlip}
        role="button"
        tabIndex={0}
        aria-expanded={flipped}
        aria-label={flipped ? `收起 ${cur.headword} 的释义` : `翻面查看 ${cur.headword} 的释义`}
        onKeyDown={handleCardKeyDown}
      >
        <div className="review-card__head">
          <p className="word word--xl" lang="en">
            {cur.headword}
          </p>
          <button
            type="button"
            className="review-card__speak"
            aria-label="发音"
            onClick={e => {
              e.stopPropagation() // Clicking to speak must not also flip the card
              pronounce(cur.headword)
            }}
          >
            <Icon name="speak" />
          </button>
        </div>
        {flipped && <ReviewCardBack word={cur} />}
      </Card>
    </Page>
  )
}
