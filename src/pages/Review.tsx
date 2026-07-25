import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { buildQueue } from '../lib/queue'
import { todayStr } from '../lib/srs'
import { speak } from '../lib/tts'
import { ReviewCardBack } from './ReviewCard'
import { advance, buildSessionQueue, currentId, isDone } from './reviewQueue'
import type { SessionQueue } from './reviewQueue'
import { useApp } from '../state/store'
import type { Grade } from '../types'
import './Review.css'

/**
 * 键盘只在"没有落在文本输入控件里"时接管空格/数字键。
 * 本页目前没有任何输入框,但保留这层判断,免得以后加了输入框会被静默吃掉按键。
 */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

const GRADE_KEYS: Record<string, Grade> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }

/**
 * Task 17 实现。
 *
 * 会话队列在挂载时用 buildQueue() 建一次(见 useState 惰性初始值),此后只用
 * reviewQueue.ts 的纯函数推进 —— grade() 会改全局 progress,现算的队列会在
 * 用户眼皮底下重排,所以中途绝不能重新调用 buildQueue()。
 *
 * "翻面"状态不用 useEffect 同步:直接从 (当前卡 id, 该词 progress 状态,
 * 用户对*这张卡*的手动翻面) 三者在渲染时算出来 —— 手动翻面记录着 {id, value},
 * 一旦队首换了词,id 对不上,自然回退到"是否新词"的默认值,不需要另外重置。
 */
export function Review() {
  const { words, progress, grade } = useApp()
  const [today] = useState(() => todayStr(new Date()))
  const [queue, setQueue] = useState<SessionQueue>(() => {
    const q = buildQueue(words, progress, today)
    return buildSessionQueue(q.due, q.fresh)
  })
  const [manualFlip, setManualFlip] = useState<{ id: string; value: boolean } | null>(null)
  // 打分之后需要"读回落库结果"才能决定要不要塞回队尾(见 reviewQueue.advance 的注释),
  // 这个 ref 只是在等待这一读之间记一下是哪张卡、防止同一张卡被连点两次打分。
  const pendingRef = useRef<string | undefined>(undefined)

  const curId = currentId(queue)
  const curWord = curId === undefined ? undefined : words.find((w) => w.id === curId)
  const curEntry = curId === undefined ? undefined : progress.words[curId]
  const isNewCard = curId !== undefined && (!curEntry || curEntry.state === 'new')
  const flipped = curId !== undefined && manualFlip?.id === curId ? manualFlip.value : isNewCard
  const finished = isDone(queue) || !curWord

  const toggleFlip = useCallback(() => {
    if (curId === undefined) return
    setManualFlip({ id: curId, value: !flipped })
  }, [curId, flipped])

  const handleGrade = useCallback(
    (g: Grade) => {
      if (pendingRef.current !== undefined) return // 上一次打分还没落定,忽略连点
      if (curId === undefined || !flipped) return // 没翻面就打分没有意义
      pendingRef.current = curId
      grade(curId, g)
    },
    [curId, flipped, grade],
  )

  // grade() 是同步落盘但异步渲染:此刻拿到的 progress 还是旧的,必须等
  // 下一次带着新 progress 的渲染,再从里面读回真实落库结果去推进队列。
  useEffect(() => {
    const pendingId = pendingRef.current
    if (pendingId === undefined) return
    pendingRef.current = undefined
    const entry = progress.words[pendingId]
    setQueue((q) => advance(q, pendingId, entry, today))
    // 队首换成了"下一次展示"—— 哪怕重新插到队尾的还是同一个 id(会话内重现),
    // 也必须清掉手动翻面记录:否则它会被 curId===manualFlip.id 误认成上一次那次展示,
    // 让本该需要用户重新翻面的重现卡直接带着答案面出场。
    setManualFlip(null)
  }, [progress, today])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (curId === undefined || isEditableTarget(document.activeElement)) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault() // 空格默认会滚动页面,必须挡掉
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

  if (finished) {
    return (
      <Page eyebrow="Review" title="复习" back="/">
        <div className="review-done">
          <p className="pos">{queue.total === 0 ? 'Nothing Due' : 'Session Done'}</p>
          <p className="review-done__count">
            今天已复习 <span className="num">{reviewedToday}</span> 个词
          </p>
          <p className="muted">
            {queue.total === 0 ? '暂时没有到期或新词需要复习。' : '今日复习已全部完成,休息一下吧。'}
          </p>
          <Link to="/" className="btn btn--primary btn--lg">
            返回今日
          </Link>
        </div>
      </Page>
    )
  }

  return (
    <Page eyebrow="Review" title="复习" back="/">
      <div className="review-progress">
        <div className="progress">
          <div className="progress__fill" style={{ width: `${(queue.seen / queue.total) * 100}%` }} />
        </div>
        <p className="num muted review-progress__count">
          {queue.seen} / {queue.total}
        </p>
      </div>

      <Card
        className={`review-card ${flipped ? 'review-card--back' : 'review-card--front'}`}
        onClick={toggleFlip}
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
              e.stopPropagation() // 别让点发音也把卡片翻过去
              speak(curWord.headword)
            }}
          >
            <Icon name="speak" />
          </button>
        </div>
        {flipped && <ReviewCardBack word={curWord} />}
      </Card>

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
    </Page>
  )
}
