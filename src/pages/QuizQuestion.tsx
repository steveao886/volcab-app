import { useRef, useState } from 'react'
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

// 拼写题的 prompt 里附带音标(形如 " /ˈæbrəɡeɪt/ "),单独抽出来用 IPA 字体渲染。
// 不假设 quiz.ts 内部拼接释义的具体格式(那是私有实现细节),只识别这一个
// 稳定的视觉模式——其余题型的 prompt 本就不含斜杠,对它们没有影响。
const PHONETIC_RE = /\/[^\s/]+\//

function PromptText({ text }: { text: string }) {
  const m = PHONETIC_RE.exec(text)
  if (!m) return <>{text}</>
  const before = text.slice(0, m.index).trimEnd()
  const after = text.slice(m.index + m[0].length).trim()
  return (
    <>
      {before}{' '}
      <span className="ipa" lang="en">{m[0]}</span>
      {after ? ` ${after}` : null}
    </>
  )
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
      <p
        className={question.type === 'word2meaning' ? 'word quiz-q__prompt' : 'quiz-q__prompt'}
        lang={question.type === 'word2meaning' ? 'en' : undefined}
      >
        <PromptText text={question.prompt} />
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
        <p className="quiz-feedback" role="status">
          {chosen === question.answer ? '回答正确' : '回答错误'}
        </p>
      ) : null}

      {locked ? (
        <Button className="quiz-q__next" variant="primary" block onClick={onNext}>
          {nextLabel}
        </Button>
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
        <PromptText text={question.prompt} />
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
        <>
          <p className="quiz-feedback" role="status">
            {correct ? '回答正确' : '回答错误'}
          </p>
          <p className="quiz-spelling-answer">
            正确拼写:<span className="word" lang="en">{question.answer}</span>
          </p>
          <Button className="quiz-q__next" variant="primary" block onClick={onNext}>
            {nextLabel}
          </Button>
        </>
      ) : null}
    </div>
  )
}
