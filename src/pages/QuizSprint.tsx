import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { optionIndexFromKey } from '../lib/keys'
import { generateQuiz } from '../lib/quiz'
import type { QuizType } from '../lib/quiz'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { useApp } from '../state/store'
import type { Word } from '../types'
import { todayStr } from '../lib/srs'

/**
 * The 60-second sprint.
 *
 * The key difference from the "mixed/contrast/audio" modes: **choosing an
 * option grades it and advances immediately**, with no separate "Next
 * question" click needed. This mode trains retrieval fluency — real
 * reading doesn't give you three seconds to think — so an extra click per
 * question would cancel out the whole point of the mode. Precisely because
 * the interaction is different, it doesn't reuse QuizQuestionView.
 */

const SPRINT_SECONDS = 60
/**
 * Only generates two four-choice types. **Spelling questions would wreck
 * the pace** — one spelling question takes as long as four multiple-choice
 * ones, turning the score into a function of "how many spelling questions
 * this round happened to draw".
 */
const SPRINT_TYPES: readonly QuizType[] = ['word2meaning', 'meaning2word']
/** At most twenty or thirty questions get answered in a minute; 60 is a comfortable upper bound, and the round ends early if actually exhausted. */
const SPRINT_QUESTIONS = 60
/** How long the correct/incorrect color holds before automatically advancing to the next question. */
const FLASH_MS = 350
/** Countdown refresh interval. 200ms is responsive enough for the seconds display to feel live, without re-rendering more than five times a second. */
const TICK_MS = 200

export function SprintSession({ words, onRestart }: { words: Word[]; onRestart: () => void }) {
  const { progress, recordSprint } = useApp()
  // Pinned once, alongside the question set: difficultyWeight's recent-miss
  // window reads it, and a session must not change meaning midway because
  // the clock rolled past midnight.
  const [today] = useState(() => todayStr(new Date()))
  const soundEnabled = isSoundEnabled(progress.settings)

  // Lazy initial value, same reasoning as QuizSession: generateQuiz uses
  // Math.random, and calling it again during a re-render would silently
  // swap out the question set mid-quiz.
  const [questions] = useState(() =>
    generateQuiz(words, progress, today, SPRINT_QUESTIONS, Math.random, SPRINT_TYPES),
  )
  // Snapshot of the record at the moment the round starts: recordSprint
  // updates progress.bestSprint in place, so without saving a copy first
  // there'd be no way to tell whether this round actually beat the record
  // (comparing after it's already updated would always read as "tied").
  const [prevBest] = useState(() => progress.bestSprint)

  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  /**
   * Questions actually answered. **Not `index`**: the round can end on the
   * clock mid-question, and `index` would then count a card that was only
   * looked at. Accuracy has to divide by what was answered, or a round that
   * timed out reads as one wrong answer it never gave.
   */
  const [asked, setAsked] = useState(0)
  const [left, setLeft] = useState(SPRINT_SECONDS)
  const [done, setDone] = useState(false)

  const answeredRef = useRef(false)
  const advanceRef = useRef<number | null>(null)
  const recordedRef = useRef(false)

  // The countdown uses a **deadline timestamp** rather than an accumulated
  // count: the latter accumulates error on every tick, and that error gets
  // especially bad when the tab is throttled by the system — a minute
  // could easily stretch into a minute and change.
  useEffect(() => {
    const deadline = Date.now() + SPRINT_SECONDS * 1000
    const id = window.setInterval(() => {
      const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setLeft(remain)
      if (remain === 0) {
        window.clearInterval(id)
        setDone(true)
      }
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  // Finishing all the questions early also ends the round (60 is a cap, not a quota)
  useEffect(() => {
    if (questions.length > 0 && index >= questions.length) setDone(true)
  }, [index, questions.length])

  useEffect(() => {
    if (done && !recordedRef.current) {
      recordedRef.current = true
      recordSprint(score, wrongIds, asked)
    }
  }, [done, score, wrongIds, asked, recordSprint])

  // Clears the pending-advance timer on unmount, so setState never fires on an already-unmounted component
  useEffect(() => () => {
    if (advanceRef.current !== null) window.clearTimeout(advanceRef.current)
  }, [])

  const q = questions[index]

  const choose = useCallback((opt: string) => {
    // No longer accepts answers once done: the instant time runs out, a finger might still be landing on a button
    if (answeredRef.current || done || q === undefined) return
    answeredRef.current = true
    const correct = opt === q.answer
    // Played synchronously within the click's call stack — iOS requires the AudioContext unlock to happen inside a user gesture
    playQuizResult(correct, soundEnabled)
    setChosen(opt)
    setAsked(n => n + 1)
    if (correct) setScore(s => s + 1)
    else setWrongIds(ids => [...ids, q.wordId])

    advanceRef.current = window.setTimeout(() => {
      answeredRef.current = false
      setChosen(null)
      setIndex(i => i + 1)
    }, FLASH_MS)
  }, [done, q, soundEnabled])

  // Number keys 1–4 answer the question. **This mode needs it most** — the
  // time spent moving a finger back and forth between four buttons within
  // one minute is pure overhead, whereas four keyboard keys sit right
  // under the fingers with no aiming required. Grading and advancing both
  // go through choose, exactly the same path as clicking (including the
  // answeredRef repeat-click guard).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (done || q === undefined) return
      const i = optionIndexFromKey(e, q.options.length)
      if (i < 0) return
      e.preventDefault()
      choose(q.options[i])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [done, q, choose])

  if (questions.length === 0) {
    return (
      <Card className="quiz-empty">
        <p>需要至少 4 个词条才能开始极速赛。当前词库还不够,先去添加或多学几个单词吧。</p>
        <Link className="btn btn--primary" to="/library">
          去词库看看
        </Link>
      </Card>
    )
  }

  if (done) {
    const best = progress.bestSprint
    const isRecord = prevBest === undefined || score > prevBest.score

    return (
      <>
        <Card>
          <p className="quiz-result__score" role="status">
            <span className="num quiz-result__score-num">{score}</span>
            <span className="muted"> 题</span>
          </p>
          <p className="muted quiz-result__summary">
            {isRecord ? '新纪录 🎉' : `60 秒答对 ${score} 题。`}
          </p>
          {best !== undefined && (
            <p className="muted quiz-sprint__best">
              个人最好成绩 <span className="num">{best.score}</span> 题 · {best.date}
            </p>
          )}
        </Card>

        <div className="quiz-result__actions">
          <Button variant="primary" size="lg" block onClick={onRestart}>
            再来一局
          </Button>
          <Link className="btn btn--secondary btn--block" to="/">
            返回今日
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="quiz-sprint__bar">
        {/* The countdown **deliberately isn't a live region**: announcing
            the remaining seconds every single second would completely
            drown out the screen reader, and the question itself is what
            actually needs to be read. role="timer" lets it still be
            queried on demand. */}
        <p className="num quiz-sprint__clock" role="timer" aria-label={`剩余 ${left} 秒`}>
          {left}
          <span className="faint quiz-sprint__unit">s</span>
        </p>
        <div className="progress quiz-sprint__progress">
          <div className="progress__fill" style={{ width: `${(left / SPRINT_SECONDS) * 100}%` }} />
        </div>
        <p className="num muted quiz-sprint__score">
          {score} 题
        </p>
      </div>

      <Card>
        <div className="quiz-q">
          <p className="quiz-q__label">
            {q.type === 'word2meaning' ? '选出正确的释义' : '选出对应的单词'}
          </p>
          <p
            className={q.type === 'word2meaning' ? 'word quiz-q__prompt' : 'quiz-q__prompt'}
            lang={q.type === 'word2meaning' ? 'en' : undefined}
          >
            {q.prompt}
          </p>

          <div className="quiz-options" role="group" aria-label="选项">
            {q.options.map((opt, i) => {
              let variant: 'secondary' | 'correct' | 'incorrect' = 'secondary'
              if (chosen !== null && opt === q.answer) variant = 'correct'
              else if (chosen !== null && opt === chosen) variant = 'incorrect'
              return (
                <Button
                  key={opt}
                  type="button"
                  variant={variant}
                  wrap
                  block
                  disabled={chosen !== null}
                  lang={q.type === 'word2meaning' ? undefined : 'en'}
                  onClick={() => choose(opt)}
                >
                  <span>
                    <span className="quiz-option__key">{i + 1}</span>
                    {opt}
                  </span>
                </Button>
              )
            })}
          </div>
        </div>
      </Card>
    </>
  )
}
