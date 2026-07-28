import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Page } from '../components/Page'
import { generateAudioQuiz, generateContrastQuiz, generateQuiz } from '../lib/quiz'
import type { QuizQuestion } from '../lib/quiz'
import { useApp } from '../state/store'
import type { Word } from '../types'
import { QuizQuestionView } from './QuizQuestion'
import { SprintSession } from './QuizSprint'
import './Quiz.css'

const QUESTION_COUNT = 10

/**
 * Extra practice modes. Driven by the `?mode=` query param, consistent
 * with the existing precedent set by `/review?mode=lapses`.
 *
 * **Defaults to "mixed", exactly matching pre-modes behavior** — this is
 * the path taken every single day, and it shouldn't cost an extra click or
 * an extra page just because three more modes were added.
 */
const MODES = [
  { key: 'mixed', label: '综合' },
  { key: 'contrast', label: '辨析' },
  { key: 'audio', label: '听音' },
  { key: 'sprint', label: '极速' },
] as const

type QuizMode = (typeof MODES)[number]['key']

const isMode = (v: string | null): v is QuizMode => MODES.some(m => m.key === v)

/** Explanation for when no questions can be generated: each mode is missing something different, and one generic message would leave people not knowing what to do. */
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint'>, string> = {
  mixed: '需要至少 4 个词条才能测试。当前词库还不够,先去添加或多学几个单词吧。',
  contrast: '你学过的词里还凑不出易混的一对。辨析只考已经学过的词 —— 拿两个没见过的词问「该用哪个」没有意义。再学一阵子,这里的题会自己多起来。',
  audio: '需要至少 4 个词条才能开始听音练习。当前词库还不够,先去添加或多学几个单词吧。',
}

/**
 * All the state for one round of quizzing. "Test again" is implemented by
 * deliberately swapping out this component itself via `key` (see the end
 * of Quiz()), rather than adding an internal reset branch — questions,
 * score, and answered state are all zeroed out by remounting, with no
 * field to clear by hand and nothing to accidentally miss.
 */
function QuizSession({
  words,
  mode,
  onRestart,
}: {
  words: Word[]
  mode: Exclude<QuizMode, 'sprint'>
  onRestart: () => void
}) {
  const { progress, recordQuiz } = useApp()

  // Generated only once, on mount: all three generator functions default to
  // Math.random under the hood, so calling them again during a re-render
  // would silently swap out the question set mid-quiz. A lazy initial value
  // with no dependency on any state guarantees this round uses the same
  // question set start to finish.
  const [questions] = useState<QuizQuestion[]>(() => {
    if (mode === 'contrast') return generateContrastQuiz(words, progress, QUESTION_COUNT)
    if (mode === 'audio') return generateAudioQuiz(words, progress, QUESTION_COUNT)
    return generateQuiz(words, progress, QUESTION_COUNT)
  })
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  // recordQuiz should only ever fire once, at the moment the results page
  // is reached; no subsequent re-render (e.g. a global state update
  // triggered by recordQuiz itself) may fire it a second time.
  const recordedRef = useRef(false)
  // Double-click/repeat-click guard for "Next question", the same pattern
  // as answeredRef in QuizQuestion.tsx: set synchronously to block the
  // second click, rather than waiting for the disabled attribute to take
  // effect on the next render. Re-unlocked when index changes (see the
  // effect below), otherwise the next question would never be clickable
  // again.
  const nextGuardRef = useRef(false)

  const total = questions.length
  const done = index >= total && total > 0

  const handleAnswered = useCallback((correct: boolean, wordId: string) => {
    if (correct) setScore(s => s + 1)
    else setWrongIds(ids => [...ids, wordId])
  }, [])

  const handleNext = useCallback(() => {
    if (nextGuardRef.current) return
    nextGuardRef.current = true
    setIndex(i => i + 1)
  }, [])

  useEffect(() => {
    nextGuardRef.current = false
  }, [index])

  useEffect(() => {
    if (done && !recordedRef.current) {
      recordedRef.current = true
      recordQuiz(score, total, wrongIds)
    }
  }, [done, score, total, wrongIds, recordQuiz])

  const wordsById = useMemo(() => new Map(words.map(w => [w.id, w])), [words])

  if (total === 0) {
    return (
      <Card className="quiz-empty">
        <p>{EMPTY_HINT[mode]}</p>
        <Link className="btn btn--primary" to="/library">
          去词库看看
        </Link>
      </Card>
    )
  }

  if (done) {
    const wrongWords = wrongIds
      .map(id => wordsById.get(id))
      .filter((w): w is Word => w !== undefined)

    return (
      <>
        <Card>
          <p className="quiz-result__score" role="status">
            <span className="num quiz-result__score-num">{score}</span>
            <span className="muted"> / {total}</span>
          </p>
          <p className="muted quiz-result__summary">
            {score === total ? '全部答对,漂亮!' : `本轮测了 ${total} 题,答对 ${score} 题。`}
          </p>
        </Card>

        {wrongWords.length > 0 ? (
          <Card pad="none">
            <p className="quiz-q__label quiz-wrong-title">错词 · {wrongWords.length}</p>
            <ul className="quiz-wrong-list">
              {wrongWords.map(w => (
                <li key={w.id}>
                  <Link className="quiz-wrong-list__item" to={`/word/${w.id}`}>
                    <span className="word" lang="en">
                      {w.headword}
                    </span>
                    <span className="muted">{w.meanings[0]?.zh}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <div className="quiz-result__actions">
          <Button variant="primary" size="lg" block onClick={onRestart}>
            再测一轮
          </Button>
          <Link className="btn btn--secondary btn--block" to="/">
            返回今日
          </Link>
        </div>
      </>
    )
  }

  const q = questions[index]
  const isLast = index === total - 1

  return (
    <>
      <div className="quiz-progress">
        <div
          className="progress"
          role="progressbar"
          aria-label="测试进度"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
          aria-valuetext={`第 ${index + 1} / ${total} 题`}
        >
          <div className="progress__fill" style={{ width: `${(index / total) * 100}%` }} />
        </div>
        <p className="muted num quiz-progress__count">
          第 {index + 1} / {total} 题
        </p>
      </div>
      <Card>
        <QuizQuestionView
          key={index}
          question={q}
          onAnswered={correct => handleAnswered(correct, q.wordId)}
          onNext={handleNext}
          nextLabel={isLast ? '查看成绩' : '下一题'}
        />
      </Card>
    </>
  )
}

/**
 * Task 18 implementation: 10 multiple-choice/spelling questions, instant
 * right/wrong feedback, a results page.
 *
 * Handling of leaving the page: an incomplete quiz is never persisted —
 * navigating away just unmounts QuizSession, and re-entering /quiz counts
 * as starting a fresh round. recordQuiz only ever fires once, at the
 * moment all questions are actually answered and the results page is
 * reached; leaving partway through leaves no trace and never counts a
 * "half-finished" attempt as today's quiz.
 */
export function Quiz() {
  const { words } = useApp()
  const [params, setParams] = useSearchParams()
  const [session, setSession] = useState(0)

  const raw = params.get('mode')
  const mode: QuizMode = isMode(raw) ? raw : 'mixed'

  const restart = useCallback(() => setSession(s => s + 1), [])

  const switchMode = (next: QuizMode) => {
    if (next === mode) return
    // replace instead of push: switching modes isn't "a place you visited",
    // so the system back gesture should return to the Today page, not walk
    // backward through the four modes one by one (avoiding a repeat of the
    // Library page's old mistake of a history stack that only ever grows).
    setParams(next === 'mixed' ? {} : { mode: next }, { replace: true })
    setSession(s => s + 1)
  }

  return (
    <Page eyebrow="Quiz" title="测试" back="/">
      <div className="quiz-modes" role="group" aria-label="测试模式">
        {MODES.map(m => (
          <Chip
            key={m.key}
            label={m.label}
            selected={mode === m.key}
            onClick={() => switchMode(m.key)}
          />
        ))}
      </div>

      {/* mode is folded into the key: switching modes must swap in a whole
          new round of questions, rather than stuffing new questions into
          the old session's question numbering. This is the same technique
          as "test again" (zeroing out via remount, not clearing fields one
          by one). */}
      {mode === 'sprint' ? (
        <SprintSession key={`sprint-${session}`} words={words} onRestart={restart} />
      ) : (
        <QuizSession key={`${mode}-${session}`} words={words} mode={mode} onRestart={restart} />
      )}
    </Page>
  )
}
