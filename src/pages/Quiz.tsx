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
 * 加练模式。走 `?mode=` 查询参数,与 `/review?mode=lapses` 的既有先例一致。
 *
 * **默认是「综合」,与加模式之前的行为完全一致** —— 这是每天都会走的一条路,
 * 不该因为多了三个模式就多一次点击或多一层页面。
 */
const MODES = [
  { key: 'mixed', label: '综合' },
  { key: 'contrast', label: '辨析' },
  { key: 'audio', label: '听音' },
  { key: 'sprint', label: '极速' },
] as const

type QuizMode = (typeof MODES)[number]['key']

const isMode = (v: string | null): v is QuizMode => MODES.some(m => m.key === v)

/** 出不来题时的说明:每种模式缺的东西不一样,一句通用文案会让人不知道该干嘛。 */
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint'>, string> = {
  mixed: '需要至少 4 个词条才能测试。当前词库还不够,先去添加或多学几个单词吧。',
  contrast: '词库里还找不出足够接近的易混词对。辨析题要靠近义词重叠来配对,再多收几个近义的高阶词就会出现了。',
  audio: '需要至少 4 个词条才能开始听音练习。当前词库还不够,先去添加或多学几个单词吧。',
}

/**
 * 一轮测试的全部状态。刻意用 `key` 换掉这个组件本身(见 Quiz() 末尾)来实现
 * 「再测一轮」,而不是在内部加一个 reset 分支——题目、比分、已判分状态
 * 全部靠重新挂载归零,不必逐个字段清空,也不会漏清。
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

  // 只在组件挂载时生成一次:三个生成函数默认都走 Math.random,若在渲染期间
  // 重新调用会在答题过程中把题目集悄悄换掉。惰性初始值 + 不依赖任何 state
  // 保证这轮测试从头到尾用同一份题目。
  const [questions] = useState<QuizQuestion[]>(() => {
    if (mode === 'contrast') return generateContrastQuiz(words, progress, QUESTION_COUNT)
    if (mode === 'audio') return generateAudioQuiz(words, progress, QUESTION_COUNT)
    return generateQuiz(words, progress, QUESTION_COUNT)
  })
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  // recordQuiz 只应该在到达结果页那一刻调用一次;后续任何重渲染
  // (比如 recordQuiz 触发的全局状态更新)都不能再触发第二次。
  const recordedRef = useRef(false)
  // 「下一题」的双击/连击守卫,与 QuizQuestion.tsx 里 answeredRef 是同一个模式:
  // 同步置位挡掉第二次点击,而不是等 disabled 属性在下一次渲染后才生效。
  // index 变化时(见下面的 effect)重新解锁,否则下一题就再也点不动了。
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
 * Task 18 实现:10 题选择/拼写、即时对错反馈、成绩页。
 *
 * 离开页面的处理:未完成的测验不做任何持久化——路由切走会直接卸载
 * QuizSession,再进 /quiz 视为开始一轮新的测试。recordQuiz 只在真正
 * 答完全部题目并看到结果页时才会被调用一次,中途离开不留痕迹,
 * 也不会把「测了一半」算作今天测过。
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
    // replace 而不是 push:模式切换不是"去过的地方",系统返回手势应该退回今日页,
    // 而不是在四个模式之间倒着走一遍(词库页那条历史栈只增不减的老毛病别再犯)。
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

      {/* key 里带上 mode:切模式必须换一整轮新题,而不是把新题塞进旧会话的题号里。
          这与「再测一轮」用的是同一个手法(靠重新挂载归零,不逐个字段清空)。 */}
      {mode === 'sprint' ? (
        <SprintSession key={`sprint-${session}`} words={words} onRestart={restart} />
      ) : (
        <QuizSession key={`${mode}-${session}`} words={words} mode={mode} onRestart={restart} />
      )}
    </Page>
  )
}
