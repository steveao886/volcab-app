import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { optionIndexFromKey } from '../lib/keys'
import { pushRecent, recentWindow } from '../lib/passage'
import { eligibleGroups, generateRecallSession, orderCorrect, wrongIdsFor } from '../lib/senseGroup'
import type { RecallQuestion, SenseGroup } from '../lib/senseGroup'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import type { Word } from '../types'

const QUESTION_COUNT = 10

/**
 * 回想 — the Chinese-to-English direction. A scenario sentence appears
 * alone; the user retrieves in their head, commits (我想好了 / 想不起来),
 * and only then does the card reveal what it wants. The commit gate is the
 * whole mechanism: it replaces typing without turning production back into
 * recognition. See docs/superpowers/specs/2026-08-07-recall-mode-design.md.
 */

type Stage = 'commit' | 'answer' | 'revealed'

interface RecallQuestionViewProps {
  question: RecallQuestion
  onAnswered: (correct: boolean, wrongIds: string[]) => void
  onNext: () => void
  nextLabel: string
}

function RecallQuestionView({ question, onAnswered, onNext, nextLabel }: RecallQuestionViewProps) {
  const { progress } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)
  const [stage, setStage] = useState<Stage>('commit')
  const [correct, setCorrect] = useState(false)
  /** 唤词: the one option picked. 排序: the tap sequence so far. */
  const [picked, setPicked] = useState<string[]>([])
  const answeredRef = useRef(false)
  const commitRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  // Focus 我想好了 on mount: Enter walks the happy path with no pointer.
  // Standard button focus, not a custom shortcut, so nothing to print.
  useEffect(() => {
    commitRef.current?.focus()
  }, [])
  useEffect(() => {
    if (stage === 'revealed') nextRef.current?.focus()
  }, [stage])

  const settle = useCallback((isCorrect: boolean, pick: string[] | null) => {
    if (answeredRef.current) return
    answeredRef.current = true
    // Synchronously inside the tap's call stack — iOS unlocks audio only inside a user gesture.
    playQuizResult(isCorrect, soundEnabled)
    setCorrect(isCorrect)
    setStage('revealed')
    onAnswered(isCorrect, isCorrect ? [] : wrongIdsFor(question, pick))
  }, [question, soundEnabled, onAnswered])

  const giveUp = useCallback(() => settle(false, null), [settle])

  const chooseRecall = useCallback((opt: string) => {
    // The pick lands in state as well as in settle(): the reveal reads
    // `picked` for the 你的选择 tag and to tell a wrong pick apart from
    // 想不起来 (which leaves it empty).
    setPicked([opt])
    settle(opt === question.answer[0], [opt])
  }, [question, settle])

  const tapOrder = useCallback((opt: string) => {
    setPicked(prev => (prev.includes(opt) ? prev.filter(p => p !== opt) : [...prev, opt]))
  }, [])

  const confirmOrder = useCallback(() => {
    if (picked.length !== question.answer.length) return
    settle(orderCorrect(picked, question.answer), picked)
  }, [picked, question, settle])

  // Number keys tap options in both kinds, the same muscle memory as every
  // other choice question; silenced once revealed so Enter belongs to 下一题.
  useEffect(() => {
    if (stage !== 'answer') return
    function onKeyDown(e: KeyboardEvent) {
      const i = optionIndexFromKey(e, question.options.length)
      if (i < 0) return
      e.preventDefault()
      const opt = question.options[i]
      if (question.kind === 'recall') chooseRecall(opt)
      else tapOrder(opt)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stage, question, chooseRecall, tapOrder])

  const revealed = stage === 'revealed'

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">
        {stage === 'commit'
          ? '想表达下面这句话,你会用哪个词?'
          : question.kind === 'recall'
            ? '你刚才想到的是哪个?'
            : '三个都沾边 —— 按贴切程度排序,最贴切的先点'}
      </p>
      <p className="quiz-q__prompt">{question.prompt}</p>

      {stage === 'commit' ? (
        <div className="recall-gate">
          <Button ref={commitRef} variant="primary" block onClick={() => setStage('answer')}>
            我想好了
          </Button>
          {/* A first-class exit, not a give-up: the mode's subject is "can I
              produce it right now", so "no" must be sayable honestly — the
              alternative is guessing through the options and polluting the
              signal. */}
          <Button variant="secondary" block onClick={giveUp}>
            想不起来
          </Button>
        </div>
      ) : (
        <>
          <div className="quiz-options" role="group" aria-label="选项">
            {question.options.map((opt, i) => {
              const orderPos = picked.indexOf(opt)
              let variant: 'secondary' | 'correct' | 'incorrect' = 'secondary'
              if (revealed && question.kind === 'recall') {
                if (opt === question.answer[0]) variant = 'correct'
                else if (opt === picked[0]) variant = 'incorrect'
              } else if (revealed && question.kind === 'order') {
                const at = question.answer.indexOf(opt)
                if (at !== -1 && picked[at] === opt) variant = 'correct'
                else variant = 'incorrect'
              }
              return (
                <Button
                  key={opt}
                  type="button"
                  variant={variant}
                  wrap
                  block
                  disabled={revealed}
                  lang="en"
                  aria-pressed={question.kind === 'order' ? orderPos !== -1 : undefined}
                  onClick={() => (question.kind === 'recall' ? chooseRecall(opt) : tapOrder(opt))}
                >
                  <span>
                    <span className="quiz-option__key">{i + 1}</span>
                    {opt}
                  </span>
                  {/* The stamp is the state: tapping again un-stamps, and the
                      numbers renumber themselves because they are indices. */}
                  {question.kind === 'order' && orderPos !== -1 && !revealed ? (
                    <span className="quiz-option__tag recall-stamp">{'①②③④'[orderPos]}</span>
                  ) : null}
                  {revealed && question.kind === 'recall' && opt === question.answer[0] ? (
                    <span className="quiz-option__tag">正确答案</span>
                  ) : null}
                  {revealed && question.kind === 'recall' && opt === picked[0] && opt !== question.answer[0] ? (
                    <span className="quiz-option__tag">你的选择</span>
                  ) : null}
                  {revealed && question.kind === 'order' ? (
                    <span className="quiz-option__tag">
                      标准第 {question.answer.indexOf(opt) + 1} · 你排第 {orderPos === -1 ? '—' : orderPos + 1}
                    </span>
                  ) : null}
                </Button>
              )
            })}
          </div>

          {question.kind === 'order' && !revealed ? (
            <Button
              className="quiz-q__next"
              variant="primary"
              block
              disabled={picked.length !== question.answer.length}
              onClick={confirmOrder}
            >
              确认顺序
            </Button>
          ) : null}
        </>
      )}

      {revealed ? (
        <>
          <p className="quiz-feedback" role="status">
            {correct ? '回答正确' : picked.length === 0 ? '想不起来 —— 那就在这儿把它记住' : '回答错误'}
          </p>
          {question.kind === 'order' || picked.length === 0 ? (
            <p className="recall-key" lang="en">
              {question.answer.length > 1 ? question.answer.join(' → ') : question.answer[0]}
            </p>
          ) : null}
          {/* The why is what stops the reveal being a bare assertion: it
              names the dimension that decides (object, register,
              connotation, grammar). Same job as the contrast card's note. */}
          <p className="recall-why">{question.why}</p>
          <Button ref={nextRef} className="quiz-q__next" variant="primary" block onClick={onNext}>
            {nextLabel}
          </Button>
        </>
      ) : null}
    </div>
  )
}

/**
 * One round of 回想. Same session skeleton as QuizSession (lazy question
 * set, remount-to-restart, recordQuiz exactly once at the results page) —
 * kept separate because the commit gate, the two question kinds and the
 * 巩固 exit share almost no markup with the four-choice flow.
 */
export function RecallSession({
  words,
  groups,
  onRestart,
}: {
  words: Word[]
  groups: SenseGroup[]
  onRestart: () => void
}) {
  const { progress, recordQuiz, consolidateWord } = useApp()

  const [questions] = useState<RecallQuestion[]>(() => {
    const byId = new Map(words.map(w => [w.id, w]))
    const eligible = eligibleGroups(groups, byId, progress)
    // Recently seen prompts are demoted behind unseen ones — the same
    // windowing the passage picker uses (the one surface the repetition
    // audit measured at 0% repeats). The window scales with the eligible
    // pool so something always stays fresh to draw.
    const recent = storage.get<string[]>('recentRecall') ?? []
    const seen = new Set(recent.slice(0, recentWindow(eligible.length)))
    return generateRecallSession(groups, byId, progress, seen, QUESTION_COUNT, Math.random)
  })
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  const [consolidated, setConsolidated] = useState<Set<string>>(new Set())
  const recordedRef = useRef(false)
  const nextGuardRef = useRef(false)

  const total = questions.length
  const done = index >= total && total > 0

  const handleAnswered = useCallback((correct: boolean, ids: string[], q: RecallQuestion) => {
    // Seen means answered, not generated: quitting a session halfway must
    // not mark the unreached prompts as stale.
    storage.set('recentRecall', pushRecent(storage.get<string[]>('recentRecall') ?? [], q.prompt))
    if (correct) { setScore(s => s + 1); return }
    setWrongIds(prev => [...new Set([...prev, ...ids])])
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
        <p>
          你学过的词里还凑不出可以回想的一组。回想只考已经学过的近义词组 ——
          一组里哪怕有一个词没学过,排它就没有意义。再学一阵子,这里的题会自己多起来。
        </p>
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
                  <div className="recall-wrong-row">
                    <Link className="quiz-wrong-list__item" to={`/word/${w.id}`}>
                      <span className="word" lang="en">
                        {w.headword}
                      </span>
                      <span className="muted">{w.meanings[0]?.zh}</span>
                    </Link>
                    {/* 巩固: the deliberate exit into the drill loop — due
                        today, lapse counted, and the word earns its place in
                        还没记牢 through the review grade it now gets, not
                        through this button faking the scheduler's signals. */}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={consolidated.has(w.id)}
                      onClick={() => {
                        consolidateWord(w.id)
                        setConsolidated(prev => new Set(prev).add(w.id))
                      }}
                    >
                      {consolidated.has(w.id) ? '已进今日复习' : '巩固'}
                    </Button>
                  </div>
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
        <RecallQuestionView
          key={index}
          question={q}
          onAnswered={(correct, ids) => handleAnswered(correct, ids, q)}
          onNext={handleNext}
          nextLabel={isLast ? '查看成绩' : '下一题'}
        />
      </Card>
    </>
  )
}
