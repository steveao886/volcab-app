import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { pickPassage, pushRecent } from '../lib/passage'
import type { Passage, PassageQuestion, Token } from '../lib/passage'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import type { Word } from '../types'

/**
 * Passage word-choice cloze.
 *
 * The key difference from the other four modes: **submit-once**. Existing
 * question types lock as soon as you tap an answer; here you fill in the
 * whole passage, then submit, and you're free to change anything along the
 * way. The reason is that the blanks are mutual clues — realizing at the
 * fifth blank that the second one is wrong is the normal way to solve this
 * question, not a mistake; refusing to let you change an answer would strip
 * away the core inference process of this question type.
 * Precisely because the interaction is different, it doesn't reuse
 * QuizQuestionView (same reason as QuizSprint).
 */
export function PassageSession({
  words,
  passages,
  onRestart,
}: {
  words: Word[]
  passages: Passage[]
  onRestart: () => void
}) {
  const { progress, recordQuiz } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)

  // Lazy initial value, same reason as QuizSession: pickPassage runs on
  // Math.random, and calling it again during a re-render would quietly swap
  // out the passage mid-answer.
  const [question] = useState<PassageQuestion | null>(() => {
    const recent = storage.get<string[]>('recentPassages') ?? []
    const q = pickPassage(passages, words, progress, todayStr(new Date()), recent)
    if (q !== null) storage.set('recentPassages', pushRecent(recent, q.passage.id))
    return q
  })

  /**
   * `filled` maps a blank index to the wordId chosen for it; `active` is the blank a
   * candidate tap will land in.
   *
   * **Held as one object rather than two useStates on purpose**: every tap needs to
   * read both and write both, and splitting them means a handler can only ever see
   * the render-time snapshot. See chooseWord below.
   */
  const [answer, setAnswer] = useState<{ filled: Record<number, string>; active: number | null }>({
    filled: {},
    active: 0,
  })
  const { filled, active } = answer
  const [submitted, setSubmitted] = useState(false)
  const recordedRef = useRef(false)

  const blanks = question?.blanks ?? []
  const filledCount = Object.keys(filled).length
  const allFilled = blanks.length > 0 && filledCount === blanks.length

  /** wordId → which blank it occupies; undefined if unused */
  const usedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const [k, v] of Object.entries(filled)) m.set(v, Number(k))
    return m
  }, [filled])

  const chooseBlank = (i: number) => {
    if (submitted) return
    setAnswer(a => ({ ...a, active: i }))
  }

  /**
   * Fill the selected blank, or withdraw the word if it already occupies one.
   *
   * **Everything is read and written inside a single updater**, against the freshest
   * state rather than the render-time closure. Two taps landing in the same React
   * batch would otherwise both see the same stale `active` and write to the same
   * blank — the second silently overwriting the first instead of moving on. Measured:
   * firing all seven chip taps in one tick filled exactly one blank. A person taps
   * slower than that, but this is the same double-tap hazard the `answeredRef` guards
   * in QuizQuestion and QuizSprint already cover, and it costs nothing to be correct.
   */
  const chooseWord = (wordId: string) => {
    if (submitted) return
    setAnswer(a => {
      const at = Object.entries(a.filled).find(([, v]) => v === wordId)?.[0]
      if (at !== undefined) {
        const next = { ...a.filled }
        delete next[Number(at)]
        return { filled: next, active: Number(at) }
      }
      const i = a.active ?? blanks.findIndex((_, n) => a.filled[n] === undefined)
      if (i < 0) return a
      const next = { ...a.filled, [i]: wordId }
      // Auto-advance to the next still-empty blank — having to tap the next blank by
      // hand every time is too tiring. Computed from `next`, so blank i is already
      // filled and can't be picked again.
      const nextEmpty = blanks.findIndex((_, n) => next[n] === undefined)
      return { filled: next, active: nextEmpty < 0 ? null : nextEmpty }
    })
  }

  const score = blanks.filter((b, i) => filled[i] === b.wordId).length

  const submit = useCallback(() => {
    if (submitted || !allFilled) return
    // Play synchronously within the click's call stack — iOS requires AudioContext unlocking to happen inside a user gesture
    playQuizResult(score === blanks.length, soundEnabled)
    setSubmitted(true)
    setAnswer(a => ({ ...a, active: null }))
  }, [submitted, allFilled, score, blanks.length, soundEnabled])

  // Depends on `question` rather than the derived `blanks`: `blanks` falls back to a
  // fresh `[]` literal on every render while `question` is null, which makes it a new
  // dependency each time. `question` comes from useState and is never updated, so it is
  // the stable thing to key on. Harmless either way — the body short-circuits until
  // `submitted`, which can't happen without a question — but a warning nobody can act on
  // is how the real ones end up ignored.
  useEffect(() => {
    if (!submitted || recordedRef.current || question === null) return
    recordedRef.current = true
    const wrongIds = question.blanks.filter((b, i) => filled[i] !== b.wordId).map(b => b.wordId)
    recordQuiz(score, question.blanks.length, wrongIds, 'passage')
  }, [submitted, question, filled, score, recordQuiz])

  if (question === null) {
    return (
      <Card className="quiz-empty">
        <p>短文题只考你学过的词,一篇里至少要凑够 3 个。再学一阵子,这里的题会自己多起来。</p>
        <Link className="btn btn--primary" to="/library">
          去词库看看
        </Link>
      </Card>
    )
  }

  /** Which blank a given token is; -1 if it isn't one */
  const blankIndexAt = (si: number, ti: number) =>
    blanks.findIndex(b => b.si === si && b.ti === ti)

  const headwordOf = (wordId: string) =>
    question.choices.find(c => c.wordId === wordId)?.headword ?? wordId

  return (
    <>
      <div className="quiz-progress">
        <div
          className="progress"
          role="progressbar"
          aria-label="填空进度"
          aria-valuemin={0}
          aria-valuemax={blanks.length}
          aria-valuenow={filledCount}
          aria-valuetext={`已填 ${filledCount} / ${blanks.length} 个空`}
        >
          <div className="progress__fill" style={{ width: `${(filledCount / blanks.length) * 100}%` }} />
        </div>
        <p className="muted num quiz-progress__count">
          已填 {filledCount} / {blanks.length} 个空
        </p>
      </div>

      <Card>
        <p className="quiz-q__label">读短文,把词填进空里</p>
        <p className="quiz-passage__title">{question.passage.title}</p>

        <div className="quiz-passage__text" lang="en">
          {question.sentences.map((tokens, si) => (
            <Fragment key={si}>
              {tokens.map((t, ti) => {
                if (t.kind === 'text') return <Fragment key={ti}>{t.text}</Fragment>
                const bi = blankIndexAt(si, ti)
                if (bi < 0) return <Fragment key={ti}>{t.surface}</Fragment>
                const chosen = filled[bi]
                const correct = chosen === blanks[bi].wordId
                const cls = ['quiz-blank-slot']
                if (!submitted && active === bi) cls.push('quiz-blank-slot--active')
                if (submitted) cls.push(correct ? 'quiz-blank-slot--correct' : 'quiz-blank-slot--wrong')
                return (
                  <button
                    key={ti}
                    type="button"
                    className={cls.join(' ')}
                    disabled={submitted}
                    aria-label={`第 ${bi + 1} 个空`}
                    onClick={() => chooseBlank(bi)}
                  >
                    {submitted && !correct && chosen !== undefined ? (
                      <span className="quiz-blank-slot__wrong">{headwordOf(chosen)}</span>
                    ) : null}
                    {submitted ? blanks[bi].surface : (chosen === undefined ? '___' : headwordOf(chosen))}
                  </button>
                )
              })}
              {si < question.sentences.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </div>

        {!submitted ? (
          <>
            <div className="quiz-passage__choices" role="group" aria-label="候选词">
              {question.choices.map(c => (
                <Chip
                  key={c.wordId}
                  label={<span lang="en">{c.headword}</span>}
                  selected={usedBy.has(c.wordId)}
                  onClick={() => chooseWord(c.wordId)}
                />
              ))}
            </div>
            <Button
              className="quiz-q__next"
              variant="primary"
              block
              disabled={!allFilled}
              onClick={submit}
            >
              {allFilled ? '交卷' : `还剩 ${blanks.length - filledCount} 个空`}
            </Button>
          </>
        ) : null}
      </Card>

      {submitted ? (
        <PassageResult
          question={question}
          score={score}
          wrongSentences={new Set(blanks.filter((b, i) => filled[i] !== b.wordId).map(b => b.si))}
          onRestart={onRestart}
        />
      ) : null}
    </>
  )
}

/**
 * The result after submitting: score + sentence-by-sentence Chinese-English comparison.
 *
 * **The Chinese translation only appears here.** Showing it while you're
 * still answering would put the answer in Chinese right next to the blank —
 * "董事会对并购感到忧虑" (the board is apprehensive about the merger), and
 * there's nothing left to think about for apprehensive.
 */
function PassageResult({
  question,
  score,
  wrongSentences,
  onRestart,
}: {
  question: PassageQuestion
  score: number
  /** Indices of the sentences containing a blank that was filled wrong */
  wrongSentences: Set<number>
  onRestart: () => void
}) {
  const total = question.blanks.length

  return (
    <>
      <Card>
        <p className="quiz-result__score" role="status">
          <span className="num quiz-result__score-num">{score}</span>
          <span className="muted"> / {total}</span>
        </p>
        <p className="muted quiz-result__summary">
          {score === total ? '全部填对,漂亮!' : `${total} 个空,填对 ${score} 个。`}
        </p>
      </Card>

      <Card>
        <p className="quiz-q__label">逐句对照</p>
        <ol className="quiz-passage__pairs">
          {question.passage.zh.map((zh, si) => (
            <li key={si} className={wrongSentences.has(si) ? 'quiz-passage__pair--wrong' : undefined}>
              <p lang="en">{plainSentence(question.sentences[si])}</p>
              <p className="muted">{zh}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="quiz-result__actions">
        <Button variant="primary" size="lg" block onClick={onRestart}>
          再来一篇
        </Button>
        <Link className="btn btn--secondary btn--block" to="/">
          返回今日
        </Link>
      </div>
    </>
  )
}

/** Reconstructs the plain, unmarked English sentence from tokens — the comparison area shows the complete sentence, not the question text with blanks. */
function plainSentence(tokens: Token[]): string {
  return tokens.map(t => (t.kind === 'text' ? t.text : t.surface)).join('')
}
