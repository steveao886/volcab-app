import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { TextInput } from '../components/TextInput'
import type { QuizQuestion, QuizType } from '../lib/quiz'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { useApp } from '../state/store'

/** 每种题型的作答说明。 */
const TYPE_LABEL: Record<QuizType, string> = {
  word2meaning: '选出正确的释义',
  meaning2word: '选出对应的单词',
  spelling: '根据释义拼写单词',
  clozeExample: '根据例句选出正确的单词',
  clozeCollocation: '根据搭配选出正确的单词',
  synonymHint: '选出对应的单词',
}

/** synonymHint 题的种类标签:界面必须标明提示词是近义还是反义,
 *  否则用户无从判断该选意思相同的还是相反的。 */
const HINT_KIND_LABEL: Record<'synonym' | 'antonym', string> = {
  synonym: '与它意思相近的词是?',
  antonym: '与它意思相反的词是?',
}

const BLANK = '___'

/** 挖空题把 prompt 里的 "___" 单独包一层 span,让空格比正文更醒目。 */
function renderBlanked(text: string): ReactNode {
  const parts = text.split(BLANK)
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <span className="quiz-blank">{BLANK}</span> : null}
    </Fragment>
  ))
}

interface QuizQuestionViewProps {
  question: QuizQuestion
  /** 用户第一次锁定答案时触发一次(判分用),不负责翻页 */
  onAnswered: (correct: boolean) => void
  /** 点「下一题 / 查看成绩」时触发,由父组件推进题号 */
  onNext: () => void
  nextLabel: string
}

/**
 * 单题渲染:选择题(word2meaning / meaning2word)与拼写题共用一个入口。
 * 调用方通过 `key` 换成新题号来强制重新挂载——组件内部的「已选/已提交」状态
 * 天然随之清空,不需要额外的 reset effect。
 */
export function QuizQuestionView({ question, onAnswered, onNext, nextLabel }: QuizQuestionViewProps) {
  if (question.type === 'spelling') {
    return <SpellingQuestion question={question} onAnswered={onAnswered} onNext={onNext} nextLabel={nextLabel} />
  }
  return <ChoiceQuestion question={question} onAnswered={onAnswered} onNext={onNext} nextLabel={nextLabel} />
}

interface AnswerFeedbackProps {
  correct: boolean
  onNext: () => void
  nextLabel: string
  children?: ReactNode
}

/**
 * 判题后的反馈块:选择题与拼写题共用——状态文字 + 「下一题」按钮,选择题
 * 之外还能塞进拼写题的「正确拼写」那一行(children)。
 *
 * 只在判完分那一刻挂载(父组件用 locked/submitted 条件渲染它),所以用一个
 * 只跑一次的挂载效应把焦点交给「下一题」按钮:上一步被禁用/整个移除的控件
 * (选项按钮、拼写输入框)会让焦点弹回 <body>,键盘用户不该每答一题就要
 * 从页头重新 Tab 一遍。焦点直接走 ref —— Button 现在声明了 ref prop,
 * 不必再靠一个固定 id + getElementById 绕路。
 */
function AnswerFeedback({ correct, onNext, nextLabel, children }: AnswerFeedbackProps) {
  const nextRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    nextRef.current?.focus()
  }, [])

  return (
    <>
      <p className="quiz-feedback" role="status">
        {correct ? '回答正确' : '回答错误'}
      </p>
      {children}
      <Button ref={nextRef} className="quiz-q__next" variant="primary" block onClick={onNext}>
        {nextLabel}
      </Button>
    </>
  )
}

function ChoiceQuestion({ question, onAnswered, onNext, nextLabel }: QuizQuestionViewProps) {
  const { progress } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)
  const [chosen, setChosen] = useState<string | null>(null)
  // 防止同一渲染帧内的连续点击(如误触双击)在状态还没落地前判两次分
  const answeredRef = useRef(false)
  const locked = chosen !== null
  // 选项是英文词头的题型:meaning2word / clozeExample / clozeCollocation / synonymHint。
  // 只有 word2meaning 的选项是中文释义。
  const optionLang = question.type === 'word2meaning' ? undefined : 'en'
  const isCloze = question.type === 'clozeExample' || question.type === 'clozeCollocation'
  // 例句/搭配挖空与近义反义提示的 prompt 都是英文,但不是单个词头——沿用下面
  // word2meaning 专属的辞书衬线体会误导,那套视觉语言留给「整屏唯一词头」。
  const promptLang = question.type === 'word2meaning' || isCloze || question.type === 'synonymHint' ? 'en' : undefined

  const handleChoose = (opt: string) => {
    if (answeredRef.current) return
    answeredRef.current = true
    const correct = opt === question.answer
    // 在点击的调用栈内同步播放,iOS 要求 AudioContext 解锁发生在用户手势内。
    playQuizResult(correct, soundEnabled)
    setChosen(opt)
    onAnswered(correct)
  }

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">{TYPE_LABEL[question.type]}</p>
      {question.type === 'synonymHint' && question.hintKind ? (
        <p className="quiz-hint-kind section-title">{HINT_KIND_LABEL[question.hintKind]}</p>
      ) : null}
      {/* word2meaning 的 prompt 是本题唯一的英文词头(整屏独一份的「主角」),用辞书
          衬线体当作大字招牌;meaning2word 的选项也是词头,但那是四个并列的可点控件,
          刻意保留按钮的界面字体——衬线大字会把按钮撑得高矮不一,还会让「唯一主角」
          这个视觉信号在一组选项里被稀释成噪音,这里的取舍以后不要因为「都是英文词」
          就顺手统一成 .word。 */}
      <p
        className={question.type === 'word2meaning' ? 'word quiz-q__prompt' : 'quiz-q__prompt'}
        lang={promptLang}
      >
        {isCloze ? renderBlanked(question.prompt) : question.prompt}
      </p>

      <div className="quiz-options" role="group" aria-label="选项">
        {question.options.map(opt => {
          let variant: 'secondary' | 'correct' | 'incorrect' = 'secondary'
          if (locked && opt === question.answer) variant = 'correct'
          else if (locked && opt === chosen) variant = 'incorrect'
          return (
            <Button
              key={opt}
              type="button"
              variant={variant}
              wrap
              block
              disabled={locked}
              lang={optionLang}
              onClick={() => handleChoose(opt)}
            >
              <span>{opt}</span>
              {locked && opt === question.answer ? (
                <span className="quiz-option__tag">正确答案</span>
              ) : null}
              {locked && opt === chosen && opt !== question.answer ? (
                <span className="quiz-option__tag">你的选择</span>
              ) : null}
            </Button>
          )
        })}
      </div>

      {locked ? (
        <AnswerFeedback correct={chosen === question.answer} onNext={onNext} nextLabel={nextLabel} />
      ) : null}
    </div>
  )
}

function SpellingQuestion({ question, onAnswered, onNext, nextLabel }: QuizQuestionViewProps) {
  const { progress } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)
  const [value, setValue] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect] = useState(false)
  const answeredRef = useRef(false)

  const submit = () => {
    const v = value.trim()
    if (v === '' || answeredRef.current) return
    answeredRef.current = true
    const isCorrect = v.toLowerCase() === question.answer.trim().toLowerCase()
    // 在提交的调用栈内同步播放,iOS 要求 AudioContext 解锁发生在用户手势内。
    playQuizResult(isCorrect, soundEnabled)
    setCorrect(isCorrect)
    setSubmitted(true)
    onAnswered(isCorrect)
  }

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">{TYPE_LABEL.spelling}</p>
      <p className="quiz-q__prompt">
        {question.prompt}
        {question.phonetic ? (
          <>
            {' '}
            <span className="ipa" lang="en">
              {question.phonetic}
            </span>
          </>
        ) : null}
      </p>

      <form
        className="quiz-spelling"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="你的拼写" htmlFor="quiz-spelling-input">
          <TextInput
            id="quiz-spelling-input"
            lang="en"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            disabled={submitted}
            onChange={e => setValue(e.target.value)}
          />
        </Field>
        {!submitted ? (
          <Button type="submit" variant="primary" block disabled={value.trim() === ''}>
            提交
          </Button>
        ) : null}
      </form>

      {submitted ? (
        <AnswerFeedback correct={correct} onNext={onNext} nextLabel={nextLabel}>
          <p className="quiz-spelling-answer">
            正确拼写:<span className="word" lang="en">{question.answer}</span>
          </p>
        </AnswerFeedback>
      ) : null}
    </div>
  )
}
