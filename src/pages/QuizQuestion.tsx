import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { TextInput } from '../components/TextInput'
import type { QuizQuestion, QuizType } from '../lib/quiz'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { speak } from '../lib/tts'
import { useApp } from '../state/store'
import type { Word } from '../types'

/** 每种题型的作答说明。 */
const TYPE_LABEL: Record<QuizType, string> = {
  word2meaning: '选出正确的释义',
  meaning2word: '选出对应的单词',
  spelling: '根据释义拼写单词',
  clozeExample: '根据例句选出正确的单词',
  clozeCollocation: '根据搭配选出正确的单词',
  synonymHint: '选出对应的单词',
  contrast: '两个近义词,哪个更贴合这句话?',
  audio2meaning: '听发音,选出正确的释义',
  audio2spelling: '听发音,拼写这个单词',
}

/** 题面是音频而非文字的题型。 */
const isAudio = (t: QuizType) => t === 'audio2meaning' || t === 'audio2spelling'

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
  if (question.type === 'spelling' || question.type === 'audio2spelling') {
    return <SpellingQuestion question={question} onAnswered={onAnswered} onNext={onNext} nextLabel={nextLabel} />
  }
  return <ChoiceQuestion question={question} onAnswered={onAnswered} onNext={onNext} nextLabel={nextLabel} />
}

/**
 * 音频题的题面。
 *
 * **绝不渲染 question.prompt** —— 那个字段存的是要朗读的词头,印出来就是把答案
 * 直接写在题面上(见 lib/quiz.ts 里 QuizQuestion.prompt 的注释)。
 *
 * 进题时尝试自动播一次。iOS 上 `speechSynthesis` 可能拦掉没有用户手势的播放,
 * 这里**不做任何成功与否的检测**:检测本身不可靠,而下面那个按钮就是完整的退路。
 * 被拦掉的后果只是"要自己点一下",不影响作答。
 */
function AudioPrompt({ text }: { text: string }) {
  useEffect(() => {
    speak(text)
  }, [text])

  return (
    <div className="quiz-audio">
      <Button type="button" variant="secondary" onClick={() => speak(text)} aria-label="再播放一次读音">
        <Icon name="speak" />
        再听一遍
      </Button>
      {/* iOS 侧边静音拨片会屏蔽声音,这不是缺陷但极易被当成缺陷 —— 与其让人以为
          功能坏了,不如把最常见的两个原因写在这儿。 */}
      <p className="faint quiz-audio__hint">听不到?检查系统音量与静音开关</p>
    </div>
  )
}

/**
 * 辨析题答完后的对比卡:两个易混词并排给释义、例句、搭配。
 *
 * **这才是辨析模式的真正价值。** 近义词难免有"两个都塞得进去"的句子,与其把这
 * 当缺陷躲开,不如答完就把差别摊开 —— 题目只是把注意力引到这一对上。
 *
 * 375px 下左右分栏太挤,所以是上下两块、中间一道分隔线。
 */
function ContrastCard({ answerId, otherId }: { answerId: string; otherId: string }) {
  const { words } = useApp()
  const a = words.find(w => w.id === answerId)
  const b = words.find(w => w.id === otherId)
  if (a === undefined || b === undefined) return null

  return (
    <div className="quiz-contrast">
      <p className="quiz-q__label">两个词的差别</p>
      <ContrastSide word={a} isAnswer />
      <ContrastSide word={b} isAnswer={false} />
    </div>
  )
}

function ContrastSide({ word, isAnswer }: { word: Word; isAnswer: boolean }) {
  const m = word.meanings[0]
  return (
    <div className={isAnswer ? 'quiz-contrast__side quiz-contrast__side--answer' : 'quiz-contrast__side'}>
      <p className="quiz-contrast__head">
        <span className="word" lang="en">{word.headword}</span>
        {isAnswer && <span className="quiz-option__tag">本题答案</span>}
      </p>
      {m !== undefined && (
        <>
          <p lang="en">
            <span className="pos">{m.pos}</span> {m.en}
          </p>
          <p className="muted">{m.zh}</p>
        </>
      )}
      {word.examples[0] !== undefined && (
        <p className="quiz-contrast__example" lang="en">{word.examples[0]}</p>
      )}
      {word.collocations.length > 0 && (
        <div className="quiz-contrast__collocations">
          {word.collocations.slice(0, 3).map(c => (
            <Chip key={c} interactive={false} label={<span lang="en">{c}</span>} />
          ))}
        </div>
      )}
    </div>
  )
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
  // 选项是中文释义的题型:word2meaning / audio2meaning。其余都是英文词头。
  const optionLang = question.type === 'word2meaning' || question.type === 'audio2meaning' ? undefined : 'en'
  // contrast 的题面同样是挖了空的例句,渲染上与 clozeExample 完全一致。
  const isCloze =
    question.type === 'clozeExample' || question.type === 'clozeCollocation' || question.type === 'contrast'
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
      {isAudio(question.type) ? (
        <AudioPrompt text={question.prompt} />
      ) : (
        <p
          className={question.type === 'word2meaning' ? 'word quiz-q__prompt' : 'quiz-q__prompt'}
          lang={promptLang}
        >
          {isCloze ? renderBlanked(question.prompt) : question.prompt}
        </p>
      )}

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
        <AnswerFeedback correct={chosen === question.answer} onNext={onNext} nextLabel={nextLabel}>
          {question.type === 'contrast' && question.contrastId !== undefined ? (
            <ContrastCard answerId={question.wordId} otherId={question.contrastId} />
          ) : null}
        </AnswerFeedback>
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
      <p className="quiz-q__label">{TYPE_LABEL[question.type]}</p>
      {/* 听音拼写**答题时不显示音标**:刚听过发音,再把 IPA 摆出来就没什么可考的了。
          音标留到揭晓答案时给(见下面的 quiz-spelling-answer)。 */}
      {question.type === 'audio2spelling' ? (
        <AudioPrompt text={question.prompt} />
      ) : (
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
      )}

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
            {question.type === 'audio2spelling' && question.phonetic ? (
              <>
                {' '}
                <span className="ipa" lang="en">
                  {question.phonetic}
                </span>
              </>
            ) : null}
          </p>
        </AnswerFeedback>
      ) : null}
    </div>
  )
}
