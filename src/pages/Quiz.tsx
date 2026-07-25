import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { generateQuiz } from '../lib/quiz'
import type { QuizQuestion } from '../lib/quiz'
import { useApp } from '../state/store'
import type { Word } from '../types'
import { QuizQuestionView } from './QuizQuestion'
import './Quiz.css'

const QUESTION_COUNT = 10

/**
 * 一轮测试的全部状态。刻意用 `key` 换掉这个组件本身(见 Quiz() 末尾)来实现
 * 「再测一轮」,而不是在内部加一个 reset 分支——题目、比分、已判分状态
 * 全部靠重新挂载归零,不必逐个字段清空,也不会漏清。
 */
function QuizSession({
  words,
  onRestart,
}: {
  words: Word[]
  onRestart: () => void
}) {
  const { progress, recordQuiz } = useApp()

  // 只在组件挂载时生成一次:generateQuiz 默认走 Math.random,若在渲染期间
  // 重新调用会在答题过程中把题目集悄悄换掉。惰性初始值 + 不依赖任何 state
  // 保证这轮测试从头到尾用同一份题目。
  const [questions] = useState<QuizQuestion[]>(() => generateQuiz(words, progress, QUESTION_COUNT))
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  // recordQuiz 只应该在到达结果页那一刻调用一次;后续任何重渲染
  // (比如 recordQuiz 触发的全局状态更新)都不能再触发第二次。
  const recordedRef = useRef(false)

  const total = questions.length
  const done = index >= total && total > 0

  const handleAnswered = useCallback((correct: boolean, wordId: string) => {
    if (correct) setScore(s => s + 1)
    else setWrongIds(ids => [...ids, wordId])
  }, [])

  const handleNext = useCallback(() => setIndex(i => i + 1), [])

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
        <p>需要至少 4 个词条才能测试。当前词库还不够,先去添加或多学几个单词吧。</p>
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
        <div className="progress">
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
 * Task 18 实现:10 题选择/拼写、即时对错反馈、成绩页。
 *
 * 离开页面的处理:未完成的测验不做任何持久化——路由切走会直接卸载
 * QuizSession,再进 /quiz 视为开始一轮新的测试。recordQuiz 只在真正
 * 答完全部题目并看到结果页时才会被调用一次,中途离开不留痕迹,
 * 也不会把「测了一半」算作今天测过。
 */
export function Quiz() {
  const { words } = useApp()
  const [session, setSession] = useState(0)

  return (
    <Page eyebrow="Quiz" title="测试" back="/">
      <QuizSession key={session} words={words} onRestart={() => setSession(s => s + 1)} />
    </Page>
  )
}
