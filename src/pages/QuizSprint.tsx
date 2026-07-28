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

/**
 * 60 秒极速赛。
 *
 * 与「综合/辨析/听音」三种模式的关键区别:**点选项立即判分并推进**,不需要再点
 * 一次「下一题」。练的是提取流畅度 —— 真实阅读里没有三秒钟去想 —— 所以每题多
 * 一次点击会把这个模式的意义抵消掉。正因为交互不同,它没有复用 QuizQuestionView。
 */

const SPRINT_SECONDS = 60
/**
 * 只出两种四选一。**拼写题会拖垮节奏** —— 一道拼写题的时间够答四道选择题,
 * 分数就变成了"这轮抽到几道拼写题"的函数。
 */
const SPRINT_TYPES: readonly QuizType[] = ['word2meaning', 'meaning2word']
/** 一分钟最多也就答二三十题,60 道是宽裕的上限;真答完了提前结束。 */
const SPRINT_QUESTIONS = 60
/** 判对判错的颜色停留时长,之后自动进下一题。 */
const FLASH_MS = 350
/** 倒计时刷新间隔。200ms 足够让秒数看起来跟手,又不至于每秒重渲染五次以上。 */
const TICK_MS = 200

export function SprintSession({ words, onRestart }: { words: Word[]; onRestart: () => void }) {
  const { progress, recordSprint } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)

  // 惰性初始值,理由同 QuizSession:generateQuiz 走 Math.random,渲染期间重新
  // 调用会在答题过程中把题目集悄悄换掉。
  const [questions] = useState(() =>
    generateQuiz(words, progress, SPRINT_QUESTIONS, Math.random, SPRINT_TYPES),
  )
  // 开局那一刻的纪录:recordSprint 会就地刷新 progress.bestSprint,不先存一份
  // 就没法判断这轮到底破没破纪录(结算后一比,永远是"追平")。
  const [prevBest] = useState(() => progress.bestSprint)

  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [left, setLeft] = useState(SPRINT_SECONDS)
  const [done, setDone] = useState(false)

  const answeredRef = useRef(false)
  const advanceRef = useRef<number | null>(null)
  const recordedRef = useRef(false)

  // 倒计时用**截止时间戳**而不是累加计数:后者每次 tick 的误差会累积,标签页
  // 被系统降频时误差尤其大,一分钟能跑成一分十几秒。
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

  // 题目提前答完也算结束(60 道是上限,不是配额)
  useEffect(() => {
    if (questions.length > 0 && index >= questions.length) setDone(true)
  }, [index, questions.length])

  useEffect(() => {
    if (done && !recordedRef.current) {
      recordedRef.current = true
      recordSprint(score, wrongIds)
    }
  }, [done, score, wrongIds, recordSprint])

  // 卸载时清掉待推进的定时器,免得在已卸载的组件上 setState
  useEffect(() => () => {
    if (advanceRef.current !== null) window.clearTimeout(advanceRef.current)
  }, [])

  const q = questions[index]

  const choose = useCallback((opt: string) => {
    // done 之后不再收答案:时间到那一刻手指可能正落在按钮上
    if (answeredRef.current || done || q === undefined) return
    answeredRef.current = true
    const correct = opt === q.answer
    // 在点击的调用栈内同步播放,iOS 要求 AudioContext 解锁发生在用户手势内
    playQuizResult(correct, soundEnabled)
    setChosen(opt)
    if (correct) setScore(s => s + 1)
    else setWrongIds(ids => [...ids, q.wordId])

    advanceRef.current = window.setTimeout(() => {
      answeredRef.current = false
      setChosen(null)
      setIndex(i => i + 1)
    }, FLASH_MS)
  }, [done, q, soundEnabled])

  // 数字键 1–4 作答。**这个模式最需要它** —— 一分钟里手在四个按钮之间来回移动
  // 的时间是纯损耗,而键盘上四个键在手指底下不用瞄。判分与推进都走 choose,
  // 与点击完全同一条路(含 answeredRef 的连击守卫)。
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
        {/* 倒计时**不做 live region**:每秒播报一次剩余秒数会把屏幕阅读器彻底淹掉,
            而题目本身才是要读的内容。role="timer" 让它可被主动查询。 */}
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
