import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { TextInput } from '../components/TextInput'
import { optionIndexFromKey } from '../lib/keys'
import type { QuizQuestion, QuizType } from '../lib/quiz'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { speak } from '../lib/tts'
import { useApp } from '../state/store'
import type { Word } from '../types'

/** Instructions for each question type. */
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

/** Question types whose prompt is audio rather than text. */
const isAudio = (t: QuizType) => t === 'audio2meaning' || t === 'audio2spelling'

/** Kind label for synonymHint questions: the UI must indicate whether the
 *  hint word is a synonym or antonym, otherwise the user has no way to
 *  tell whether to pick a matching or opposite meaning. */
const HINT_KIND_LABEL: Record<'synonym' | 'antonym', string> = {
  synonym: '与它意思相近的词是?',
  antonym: '与它意思相反的词是?',
}

const BLANK = '___'

/** Cloze questions wrap the "___" in prompt with its own span, to make the blank more prominent than the body text. */
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
  /** Fires once, the first time the user locks in an answer (for grading); not responsible for advancing */
  onAnswered: (correct: boolean) => void
  /** Fires when "Next question / View results" is clicked; the parent component advances the question index */
  onNext: () => void
  nextLabel: string
}

/**
 * Renders a single question: multiple-choice (word2meaning / meaning2word)
 * and spelling questions share one entry point. The caller forces a
 * remount by swapping in a new question index via `key` — the component's
 * internal "chosen/submitted" state is naturally cleared along with it, so
 * no extra reset effect is needed.
 */
export function QuizQuestionView({ question, onAnswered, onNext, nextLabel }: QuizQuestionViewProps) {
  if (question.type === 'spelling' || question.type === 'audio2spelling') {
    return <SpellingQuestion question={question} onAnswered={onAnswered} onNext={onNext} nextLabel={nextLabel} />
  }
  return <ChoiceQuestion question={question} onAnswered={onAnswered} onNext={onNext} nextLabel={nextLabel} />
}

/**
 * Prompt for audio questions.
 *
 * **Never renders question.prompt** — that field stores the headword to be
 * read aloud, so printing it would put the answer directly on the prompt
 * (see the comment on QuizQuestion.prompt in lib/quiz.ts).
 *
 * Tries to auto-play once on entering the question. On iOS, `speechSynthesis`
 * may block playback that isn't triggered by a user gesture; this
 * **deliberately does no success/failure detection** — detection itself is
 * unreliable, and the button below is already a complete fallback. Being
 * blocked just means "you have to tap it yourself"; it doesn't block
 * answering.
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
      {/* iOS's physical mute switch silences the audio; that isn't a bug
          but is very easily mistaken for one — rather than let people
          think the feature is broken, spell out the two most common
          causes here. */}
      <p className="faint quiz-audio__hint">听不到?检查系统音量与静音开关</p>
    </div>
  )
}

/**
 * Comparison card shown after answering a contrast question: two
 * easily-confused words, meanings/examples/collocations side by side.
 *
 * **This is where contrast mode actually earns its keep.** Near-synonyms
 * inevitably produce sentences where "either one fits" — rather than treat
 * that as a flaw to dodge, lay the difference out plainly right after the
 * answer. The question itself is just there to draw attention to this
 * pair.
 *
 * Side-by-side columns are too cramped at 375px, so it's two stacked
 * blocks with a divider in between.
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
 * Feedback block shown after grading: shared by multiple-choice and
 * spelling questions — status text + "Next question" button, with room for
 * the spelling question's "correct spelling" line (children) beyond just
 * multiple-choice.
 *
 * Only ever mounted at the moment grading completes (the parent
 * conditionally renders it based on locked/submitted), so a mount effect
 * that runs once hands focus to the "Next question" button: the previous
 * step's disabled/removed controls (option buttons, spelling input) would
 * otherwise bounce focus back to <body>, and keyboard users shouldn't have
 * to Tab all the way from the page header after every single question.
 * Focus goes straight through a ref — Button now declares a ref prop, so
 * there's no need to route around it with a fixed id + getElementById
 * anymore.
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
  // Guards against consecutive clicks within the same render frame (e.g. an accidental double-click) grading twice before state has landed
  const answeredRef = useRef(false)
  const locked = chosen !== null
  // Question types whose options are Chinese meanings: word2meaning / audio2meaning. Everything else uses English headwords.
  const optionLang = question.type === 'word2meaning' || question.type === 'audio2meaning' ? undefined : 'en'
  // contrast's prompt is likewise a cloze example sentence, rendered identically to clozeExample.
  const isCloze =
    question.type === 'clozeExample' || question.type === 'clozeCollocation' || question.type === 'contrast'
  // The prompts for example/collocation cloze and synonym/antonym hints are
  // all English, but not a single headword — reusing word2meaning's
  // dictionary serif below would be misleading, since that visual language
  // is reserved for "the one headword on the whole screen".
  const promptLang = question.type === 'word2meaning' || isCloze || question.type === 'synonymHint' ? 'en' : undefined

  const handleChoose = useCallback(
    (opt: string) => {
      if (answeredRef.current) return
      answeredRef.current = true
      const correct = opt === question.answer
      // Played synchronously within the click's call stack — iOS requires the AudioContext unlock to happen inside a user gesture.
      playQuizResult(correct, soundEnabled)
      setChosen(opt)
      onAnswered(correct)
    },
    [question.answer, soundEnabled, onAnswered],
  )

  // Number keys 1–4 select the corresponding option directly — the same
  // muscle memory as grading 1–4 on the review page. The listener is torn
  // down as soon as the question is graded: at that point the buttons are
  // already disabled, AnswerFeedback has handed focus to "Next question",
  // and the number keys should go completely silent, leaving Enter/Space
  // to that button itself.
  useEffect(() => {
    if (locked) return
    function onKeyDown(e: KeyboardEvent) {
      const i = optionIndexFromKey(e, question.options.length)
      if (i < 0) return
      e.preventDefault()
      handleChoose(question.options[i])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [locked, question.options, handleChoose])

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">{TYPE_LABEL[question.type]}</p>
      {question.type === 'synonymHint' && question.hintKind ? (
        <p className="quiz-hint-kind section-title">{HINT_KIND_LABEL[question.hintKind]}</p>
      ) : null}
      {/* word2meaning's prompt is the only English headword on the question
          (the sole "protagonist" on the whole screen), so it uses the
          dictionary serif as a large-type headline; meaning2word's options
          are also headwords, but those are four side-by-side clickable
          controls, and the interface font is deliberately kept for
          buttons — large serif type would make the buttons uneven in
          height, and would dilute the "sole protagonist" visual signal
          into noise across a set of options. Don't casually unify this
          with .word later just because "they're all English words". */}
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
        {question.options.map((opt, i) => {
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
              {/* Printing the number on the option is what makes the
                  keyboard shortcut discoverable. Same logic as the review
                  page printing "1" on the grade buttons: an unwritten
                  shortcut might as well not exist. */}
              <span>
                <span className="quiz-option__key">{i + 1}</span>
                {opt}
              </span>
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
    // Played synchronously within the submit's call stack — iOS requires the AudioContext unlock to happen inside a user gesture.
    playQuizResult(isCorrect, soundEnabled)
    setCorrect(isCorrect)
    setSubmitted(true)
    onAnswered(isCorrect)
  }

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">{TYPE_LABEL[question.type]}</p>
      {/* Audio-spelling questions **don't show the phonetic while
          answering**: you just heard the pronunciation, so displaying the
          IPA too would leave nothing left to test. The phonetic is saved
          for when the answer is revealed (see quiz-spelling-answer below). */}
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
