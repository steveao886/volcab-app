import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import { advance, buildSessionQueue, currentId, dropCurrent, isDone } from './reviewQueue'
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

/** pendingRef 卡死时的兜底超时(ms)—— 见 advance effect 上的说明。 */
const PENDING_STUCK_TIMEOUT_MS = 2000

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
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const curId = currentId(queue)
  const curWord = curId === undefined ? undefined : words.find((w) => w.id === curId)
  const curEntry = curId === undefined ? undefined : progress.words[curId]
  const isNewCard = curId !== undefined && (!curEntry || curEntry.state === 'new')
  const flipped = curId !== undefined && manualFlip?.id === curId ? manualFlip.value : isNewCard
  const finished = isDone(queue)

  const toggleFlip = useCallback(() => {
    if (curId === undefined) return
    setManualFlip({ id: curId, value: !flipped })
  }, [curId, flipped])

  const handleGrade = useCallback(
    (g: Grade) => {
      if (pendingRef.current !== undefined) return // 上一次打分还没落定,忽略连点
      if (curId === undefined || !flipped) return // 没翻面就打分没有意义
      pendingRef.current = curId
      // 兜底:下面的 effect 依赖"grade() 落库后 progress 一定会变成新引用"这条跨模块
      // 约定(见 effect 里的说明)。万一它被打破,pendingRef 会永远卡住、打分从此
      // 在这个会话里全部失灵且没有任何报错 —— 2s 后没等到就自己解锁并留个痕迹。
      pendingTimeoutRef.current = setTimeout(() => {
        if (pendingRef.current === curId) {
          console.error(
            `[Review] 打分 "${curId}" 后 ${PENDING_STUCK_TIMEOUT_MS}ms 内没有等到新的 progress,` +
              '已强制解锁 pendingRef,否则打分按钮会在本会话内一直失效。' +
              '这通常意味着 store.tsx 的 grade() 没有像预期那样产出新的 progress 引用。',
          )
          pendingRef.current = undefined
        }
      }, PENDING_STUCK_TIMEOUT_MS)
      grade(curId, g)
    },
    [curId, flipped, grade],
  )

  // grade() 是同步落盘但异步渲染:此刻拿到的 progress 还是旧的,必须等
  // 下一次带着新 progress 的渲染,再从里面读回真实落库结果去推进队列。
  //
  // 这个 effect 能否被触发,系着一条跨模块的隐含约定:store.tsx 的 grade() 每次都会
  // 用展开运算符产出一个全新的 progress 对象(见 store.tsx 的 commitProgress/update),
  // 所以 [progress] 依赖保证打分之后一定会重新跑一次。store.tsx 对本任务是冻结文件,
  // 这条约定没有编译期保证 —— 上面 handleGrade 里的超时就是防它被静默打破。
  useEffect(() => {
    const pendingId = pendingRef.current
    if (pendingId === undefined) return
    pendingRef.current = undefined
    if (pendingTimeoutRef.current !== undefined) {
      clearTimeout(pendingTimeoutRef.current)
      pendingTimeoutRef.current = undefined
    }
    const entry = progress.words[pendingId]
    setQueue((q) => advance(q, pendingId, entry, today))
    // 队首换成了"下一次展示"—— 哪怕重新插到队尾的还是同一个 id(会话内重现),
    // 也必须清掉手动翻面记录:否则它会被 curId===manualFlip.id 误认成上一次那次展示,
    // 让本该需要用户重新翻面的重现卡直接带着答案面出场。
    setManualFlip(null)
  }, [progress, today])

  // 卸载时把兜底定时器收掉,别让它在页面走掉之后还去戳一个不存在的 ref。
  useEffect(
    () => () => {
      if (pendingTimeoutRef.current !== undefined) clearTimeout(pendingTimeoutRef.current)
    },
    [],
  )

  // 队首这个词在 words 里已经找不到了(另一台设备把它删了,同步跑在会话中途)——
  // 不能打分也没法渲染卡片,只能摘掉它、继续看队列里下一张。等打分落定(pendingRef
  // 清空)以后再摘,避免和上面那个 effect 同时改队列。
  useEffect(() => {
    if (pendingRef.current !== undefined) return
    if (curId !== undefined && curWord === undefined) {
      setQueue((q) => dropCurrent(q))
    }
  }, [curId, curWord])

  const handleCardKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // 只处理卡片本身拿到焦点的情况;子元素(发音按钮)的按键交给它自己原生处理,
      // 否则从发音按钮冒泡上来的 Space/Enter 会被这里再重复处理一次。
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation() // 别让同一个事件再冒泡到 window 上的全局监听器,避免重复翻面
        toggleFlip()
      }
    },
    [toggleFlip],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (curId === undefined || isEditableTarget(document.activeElement)) return
      if (e.key === ' ' || e.code === 'Space') {
        // 只在"什么都没聚焦"(activeElement===body)时把空格接管为翻面快捷键。
        // 卡片本身聚焦时由它自己的 onKeyDown 处理(见 handleCardKeyDown);聚焦在
        // 发音按钮/打分按钮/返回链接等原生控件上时,必须把空格让给它们自己的默认
        // 行为——否则会出现"Tab 到发音按钮按空格,结果卡片翻面而不是重新发音"
        // 这种抢焦点控件按键语义的问题。
        if (document.activeElement !== document.body) return
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
          <p className="review-done__label">{queue.total === 0 ? '暂无待复习' : '复习完成'}</p>
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

  if (!curWord) {
    // curId 存在(队列没空)但词条在 words 里已经找不到了 —— 上面的 effect 会把它
    // 从队列摘掉并推进到下一张,这里只是那一次(通常一帧内就过去)的过渡态,不能
    // 尝试渲染卡片(会因为 curWord 是 undefined 崩溃),也不能当成"会话已完成"。
    return (
      <Page eyebrow="Review" title="复习" back="/">
        <p className="muted">正在跳过一个已被移除的词条…</p>
      </Page>
    )
  }

  return (
    <Page eyebrow="Review" title="复习" back="/">
      <div className="review-progress">
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={queue.total}
          aria-valuenow={queue.seen}
          aria-valuetext={`${queue.seen} / ${queue.total}`}
        >
          <div className="progress__fill" style={{ width: `${(queue.seen / queue.total) * 100}%` }} />
        </div>
        <p className="num muted review-progress__count">
          {queue.seen} / {queue.total}
        </p>
      </div>

      <Card
        className={`review-card card--interactive ${flipped ? 'review-card--back' : 'review-card--front'}`}
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
