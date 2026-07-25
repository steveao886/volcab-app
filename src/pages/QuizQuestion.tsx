import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { TextInput } from '../components/TextInput'
import type { QuizQuestion, QuizType } from '../lib/quiz'

/** 每种题型的作答说明。 */
const TYPE_LABEL: Record<QuizType, string> = {
  word2meaning: '选出正确的释义',
  meaning2word: '选出对应的单词',
  spelling: '根据释义拼写单词',
}

// 「下一题」按钮的固定 id,配合下面的挂载效应把焦点交给它。用 id + getElementById
// 而不是 React ref——Button 组件(冻结,不可改)没有声明 ref prop,React 19 下
// 普通函数组件不会自动获得它。同一时刻只有一道题在渲染,id 不会冲突。
const NEXT_BUTTON_ID = 'quiz-next-button'

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
 * 从页头重新 Tab 一遍。
 */
function AnswerFeedback({ correct, onNext, nextLabel, children }: AnswerFeedbackProps) {
  useEffect(() => {
    document.getElementById(NEXT_BUTTON_ID)?.focus()
  }, [])

  return (
    <>
      <p className="quiz-feedback" role="status">
        {correct ? '回答正确' : '回答错误'}
      </p>
      {children}
      <Button id={NEXT_BUTTON_ID} className="quiz-q__next" variant="primary" block onClick={onNext}>
        {nextLabel}
      </Button>
    </>
  )
}

function ChoiceQuestion({ question, onAnswered, onNext, nextLabel }: QuizQuestionViewProps) {
  const [chosen, setChosen] = useState<string | null>(null)
  // 防止同一渲染帧内的连续点击(如误触双击)在状态还没落地前判两次分
  const answeredRef = useRef(false)
  const locked = chosen !== null
  // meaning2word 的选项是英文词头,word2meaning 的选项是中文释义
  const optionLang = question.type === 'meaning2word' ? 'en' : undefined

  const handleChoose = (opt: string) => {
    if (answeredRef.current) return
    answeredRef.current = true
    setChosen(opt)
    onAnswered(opt === question.answer)
  }

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">{TYPE_LABEL[question.type]}</p>
      {/* word2meaning 的 prompt 是本题唯一的英文词头(整屏独一份的「主角」),用辞书
          衬线体当作大字招牌;meaning2word 的选项也是词头,但那是四个并列的可点控件,
          刻意保留按钮的界面字体——衬线大字会把按钮撑得高矮不一,还会让「唯一主角」
          这个视觉信号在一组选项里被稀释成噪音,这里的取舍以后不要因为「都是英文词」
          就顺手统一成 .word。 */}
      <p
        className={question.type === 'word2meaning' ? 'word quiz-q__prompt' : 'quiz-q__prompt'}
        lang={question.type === 'word2meaning' ? 'en' : undefined}
      >
        {question.prompt}
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
  const [value, setValue] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect] = useState(false)
  const answeredRef = useRef(false)

  const submit = () => {
    const v = value.trim()
    if (v === '' || answeredRef.current) return
    answeredRef.current = true
    const isCorrect = v.toLowerCase() === question.answer.trim().toLowerCase()
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
