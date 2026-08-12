import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { ExampleSentence } from '../components/ExampleSentence'
import { Card } from '../components/Card'
import { optionIndexFromKey } from '../lib/keys'
import { pushRecent, recentWindow } from '../lib/passage'
import { eligibleGroups, generateRecallSession, orderCorrect, wrongIdsFor } from '../lib/senseGroup'
import type { RecallQuestion, SenseGroup } from '../lib/senseGroup'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import type { Word } from '../types'
import { todayStr } from '../lib/srs'

const QUESTION_COUNT = 10

/**
 * 回想 — the Chinese-to-English direction. A scenario sentence appears
 * alone with the asked-for chunk marked; the user retrieves in their head,
 * commits (我想好了 / 想不起来), and only then does the card reveal what it
 * wants. The commit gate is the whole mechanism: it replaces typing without
 * turning production back into recognition. See
 * docs/superpowers/specs/2026-08-07-recall-mode-design.md.
 */

type Stage = 'commit' | 'hint' | 'answer' | 'revealed'

/**
 * How a question was missed. All four are scored identically — the word is
 * not in productive vocabulary either way — but they are different findings
 * with different remedies and must not be reported as one:
 *
 * - `blank`: nothing came, not even with the English definition in front of
 *   you.
 * - `other`: something came, but it was none of the options — the learner
 *   reached for a simpler word that says roughly the same thing. This is
 *   the state the mode exists to find, and until it had its own button the
 *   only way to report it was 想不起来, which is simply false: the meaning
 *   *was* available, the word was not.
 * - `hint-hit`: the English definition unlocked it. The concept is learned;
 *   what failed is the Chinese-side handle — measured at 36.7% of the
 *   library sharing a gloss fragment with another entry, that is a content
 *   fact, not a study failure.
 * - `hint-miss`: even reading the definition, the reach was for a
 *   confusable. The sharpest finding the mode can produce.
 */
type Miss = 'blank' | 'other' | 'hint-hit' | 'hint-miss'

/**
 * The results list is where you decide what to do about a miss, so the four
 * kinds have to stay apart there: 提示后想起 asks for a better Chinese-side
 * handle, 意思到了 asks for exposure, 没想起来 asks for review, and 提示后仍错
 * asks you to open the contrast note for that pair.
 */
const MISS_TAG: Record<Miss, string> = {
  blank: '没想起来',
  other: '意思到了',
  'hint-hit': '提示后想起',
  'hint-miss': '提示后仍错',
}

interface RecallQuestionViewProps {
  question: RecallQuestion
  onAnswered: (correct: boolean, wrongIds: string[], miss: Miss | null) => void
  onNext: () => void
  nextLabel: string
  /** Fires when 巩固 is pressed. Absent during the re-drill itself — a question already being re-drilled has nothing left to queue. */
  onReinforce?: (q: RecallQuestion) => void
  reinforced: boolean
}

function RecallQuestionView({
  question, onAnswered, onNext, nextLabel, onReinforce, reinforced,
}: RecallQuestionViewProps) {
  const { progress } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)
  const [stage, setStage] = useState<Stage>('commit')
  const [correct, setCorrect] = useState(false)
  const [miss, setMiss] = useState<Miss | null>(null)
  /** 唤词: the one option picked. 排序: the tap sequence so far. */
  const [picked, setPicked] = useState<string[]>([])
  const answeredRef = useRef(false)
  /**
   * Whether the English definition was read before answering. A ref, not
   * state: settle() runs inside the tap's own call stack (iOS unlocks audio
   * only there) and must see the current value, not the render's.
   */
  const hintedRef = useRef(false)
  const commitRef = useRef<HTMLButtonElement>(null)
  const hintRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  // Focus 我想好了 on mount: Enter walks the happy path with no pointer.
  // Standard button focus, not a custom shortcut, so nothing to print.
  useEffect(() => {
    commitRef.current?.focus()
  }, [])
  useEffect(() => {
    if (stage === 'hint') hintRef.current?.focus()
  }, [stage])
  useEffect(() => {
    if (stage === 'revealed') nextRef.current?.focus()
  }, [stage])

  const settle = useCallback((isCorrect: boolean, pick: string[] | null, kind: Miss | null) => {
    if (answeredRef.current) return
    answeredRef.current = true
    // Synchronously inside the tap's call stack — iOS unlocks audio only inside a user gesture.
    playQuizResult(isCorrect, soundEnabled)
    setCorrect(isCorrect)
    setMiss(kind)
    setStage('revealed')
    onAnswered(isCorrect, isCorrect ? [] : wrongIdsFor(question, pick), kind)
  }, [question, soundEnabled, onAnswered])

  /**
   * 想不起来 is now a tier, not an exit. The English definition is the middle
   * term in `situation → concept → word`, and the Chinese ambiguity that made
   * the first attempt unfair does not exist there. Only when the group has no
   * usable definition — read side stays lenient — does this settle straight
   * away, exactly as it did before the tier existed.
   */
  const giveUp = useCallback(() => {
    if (stage === 'commit' && question.kind === 'recall' && question.hint !== undefined) {
      hintedRef.current = true
      setStage('hint')
      return
    }
    settle(false, null, 'blank')
  }, [stage, question, settle])
  // Scored exactly like 想不起来 — wrongIdsFor marks the answer and nothing
  // else, because whatever was reached for is not among this card's options
  // and cannot be identified without typing.
  const notMine = useCallback(() => settle(false, null, 'other'), [settle])

  const chooseRecall = useCallback((opt: string) => {
    // The pick lands in state as well as in settle(): the reveal reads
    // `picked` for the 你的选择 tag.
    setPicked([opt])
    const matched = opt === question.answer[0]
    // Reached through the hint: **scored wrong whatever was picked**. You
    // could not produce it cold, and cold production is what this mode
    // measures — letting the tier buy points would make the score, and the
    // SRS signal behind it, mean something softer than it says.
    if (hintedRef.current) {
      settle(false, [opt], matched ? 'hint-hit' : 'hint-miss')
      return
    }
    settle(matched, [opt], null)
  }, [question, settle])

  const tapOrder = useCallback((opt: string) => {
    setPicked(prev => (prev.includes(opt) ? prev.filter(p => p !== opt) : [...prev, opt]))
  }, [])

  const confirmOrder = useCallback(() => {
    if (picked.length !== question.answer.length) return
    settle(orderCorrect(picked, question.answer), picked, null)
  }, [picked, question, settle])

  // Number keys tap options in both kinds, the same muscle memory as every
  // other choice question; in 唤词 the key one past the last option is the
  // "none of these" escape, which is why the count is +1. Silenced once
  // revealed so Enter belongs to 下一题.
  const escapeKey = question.options.length + 1
  useEffect(() => {
    if (stage !== 'answer') return
    function onKeyDown(e: KeyboardEvent) {
      const isRecall = question.kind === 'recall'
      const i = optionIndexFromKey(e, question.options.length + (isRecall ? 1 : 0))
      if (i < 0) return
      e.preventDefault()
      if (i === question.options.length) { notMine(); return }
      const opt = question.options[i]
      if (isRecall) chooseRecall(opt)
      else tapOrder(opt)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stage, question, chooseRecall, tapOrder, notMine])

  const revealed = stage === 'revealed'

  // The emphasized chunk is the question: without it a sentence carries half
  // a dozen content words and nothing says which one is wanted. Lenient like
  // every bundled-content lookup — a group without a locatable target shows
  // the plain sentence.
  const t = question.target
  const at = t === undefined ? -1 : question.prompt.indexOf(t)
  const prompt = t !== undefined && at !== -1 ? (
    <>
      {question.prompt.slice(0, at)}
      <em className="recall-target">{t}</em>
      {question.prompt.slice(at + t.length)}
    </>
  ) : question.prompt

  const feedback =
    correct ? '回答正确'
      : miss === 'blank' ? '想不起来 —— 那就在这儿把它记住'
        : miss === 'other' ? '意思到了,词还没到 —— 这正是要练的'
          : miss === 'hint-hit' ? '提示后想起来了 —— 这次不算对,但通路正在建立'
            : miss === 'hint-miss' ? '看了英文释义还是拿错了词 —— 这一对值得单独看'
              : '回答错误'

  return (
    <div className="quiz-q">
      <p className="quiz-q__label">
        {stage === 'commit'
          ? t !== undefined ? '标出的意思,你会用哪个英文词?' : '想表达下面这句话,你会用哪个词?'
          : stage === 'hint'
            ? '换个入口 —— 读英文释义,再想一次'
            : question.kind === 'recall'
              ? '你刚才想到的是哪个?'
              : '三个都沾边 —— 按贴切程度排序,最贴切的先点'}
      </p>
      <p className="quiz-q__prompt">{prompt}</p>

      {stage === 'commit' ? (
        <div className="recall-gate">
          <Button ref={commitRef} variant="primary" block onClick={() => setStage('answer')}>
            我想好了
          </Button>
          {/* A first-class exit, not a give-up: the mode's subject is "can I
              produce it right now", so "no" must be sayable honestly — the
              alternative is guessing through the options and polluting the
              signal. */}
          <Button variant="secondary" block onClick={giveUp}>
            想不起来
          </Button>
        </div>
      ) : stage === 'hint' ? (
        /* The second tier. A native speaker goes situation → concept → word,
           never 中文 → 英文, and this definition is that middle term — it can
           carry the weight because word-entry-spec requires `en` to stand on
           its own. 减轻 is three words in this library; "to make suffering or
           a problem less severe" is one. Everything reached from here scores
           wrong, so nothing is bought by arriving. */
        <>
          <p className="recall-hint" lang="en">{question.hint}</p>
          <div className="recall-gate">
            <Button ref={hintRef} variant="primary" block onClick={() => setStage('answer')}>
              我想好了
            </Button>
            <Button variant="secondary" block onClick={giveUp}>
              还是想不起来
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="quiz-options" role="group" aria-label="选项">
            {question.options.map((opt, i) => {
              const orderPos = picked.indexOf(opt)
              let variant: 'secondary' | 'correct' | 'incorrect' = 'secondary'
              if (revealed && question.kind === 'recall') {
                if (opt === question.answer[0]) variant = 'correct'
                else if (opt === picked[0]) variant = 'incorrect'
              } else if (revealed && question.kind === 'order') {
                const idx = question.answer.indexOf(opt)
                if (idx !== -1 && picked[idx] === opt) variant = 'correct'
                else variant = 'incorrect'
              }
              return (
                <Button
                  key={opt}
                  type="button"
                  variant={variant}
                  wrap
                  block
                  disabled={revealed}
                  lang="en"
                  aria-pressed={question.kind === 'order' ? orderPos !== -1 : undefined}
                  onClick={() => (question.kind === 'recall' ? chooseRecall(opt) : tapOrder(opt))}
                >
                  <span>
                    <span className="quiz-option__key">{i + 1}</span>
                    {opt}
                  </span>
                  {/* The stamp is the state: tapping again un-stamps, and the
                      numbers renumber themselves because they are indices. */}
                  {question.kind === 'order' && orderPos !== -1 && !revealed ? (
                    <span className="quiz-option__tag recall-stamp">{'①②③④'[orderPos]}</span>
                  ) : null}
                  {revealed && question.kind === 'recall' && opt === question.answer[0] ? (
                    <span className="quiz-option__tag">正确答案</span>
                  ) : null}
                  {revealed && question.kind === 'recall' && opt === picked[0] && opt !== question.answer[0] ? (
                    <span className="quiz-option__tag">你的选择</span>
                  ) : null}
                  {revealed && question.kind === 'order' ? (
                    <span className="quiz-option__tag">
                      标准第 {question.answer.indexOf(opt) + 1} · 你排第 {orderPos === -1 ? '—' : orderPos + 1}
                    </span>
                  ) : null}
                </Button>
              )
            })}
          </div>

          {/* The third outcome, and the one the four options cannot express:
              a word did come to mind, it just wasn't any of these — usually a
              simpler one that covers the meaning. Deliberately set apart from
              the options (lighter, centred, gapped) so a thumb reaching for
              an answer never lands on it. 排序 has no equivalent: there you
              are asked to rank the three shown, which stays answerable
              whatever you happened to think of. */}
          {question.kind === 'recall' && !revealed ? (
            <div className="recall-escape">
              <Button type="button" variant="secondary" size="sm" onClick={notMine}>
                <span className="quiz-option__key">{escapeKey}</span>
                我想的不是这几个
              </Button>
            </div>
          ) : null}

          {question.kind === 'order' && !revealed ? (
            <Button
              className="quiz-q__next"
              variant="primary"
              block
              disabled={picked.length !== question.answer.length}
              onClick={confirmOrder}
            >
              确认顺序
            </Button>
          ) : null}
        </>
      )}

      {revealed ? (
        <>
          <p className="quiz-feedback" role="status">{feedback}</p>
          {question.kind === 'order' || miss !== null ? (
            <p className="recall-key" lang="en">
              {question.answer.length > 1 ? question.answer.join(' → ') : question.answer[0]}
            </p>
          ) : null}
          {/* The scenario in English, above the why. Naming the winner and
              explaining the distinction still never showed the word doing
              the job — you could learn that implicate beats incriminate
              here without once seeing the sentence either would go into.
              It renders only inside this revealed branch; the same string
              above the options would be the answer in plain sight. */}
          {question.en !== undefined && (
            <p className="recall-en" lang="en">
              <ExampleSentence sentence={question.en} headword={question.answer[0]} />
            </p>
          )}
          {/* The why is what stops the reveal being a bare assertion: it
              names the dimension that decides (object, register,
              connotation, grammar). Same job as the contrast card's note. */}
          <p className="recall-why">{question.why}</p>
          {/* 巩固 sits on the question, not on the results page: the moment
              you want it is the moment you just missed it. */}
          {!correct && onReinforce !== undefined ? (
            <Button
              variant="secondary"
              block
              disabled={reinforced}
              onClick={() => onReinforce(question)}
            >
              {reinforced ? '本轮结束后再想一遍' : '巩固 · 再想一遍'}
            </Button>
          ) : null}
          <Button ref={nextRef} className="quiz-q__next" variant="primary" block onClick={onNext}>
            {nextLabel}
          </Button>
        </>
      ) : null}
    </div>
  )
}

/**
 * One round of 回想. Same session skeleton as QuizSession (lazy question
 * set, remount-to-restart, recordQuiz exactly once) — kept separate because
 * the commit gate, the two question kinds and the re-drill share almost no
 * markup with the four-choice flow.
 */
export function RecallSession({
  words,
  groups,
  onRestart,
}: {
  words: Word[]
  groups: SenseGroup[]
  onRestart: () => void
}) {
  const { progress, recordQuiz, consolidateWord } = useApp()
  // Pinned once, alongside the question set: difficultyWeight's recent-miss
  // window reads it, and a session must not change meaning midway because
  // the clock rolled past midnight.
  const [today] = useState(() => todayStr(new Date()))

  const [questions] = useState<RecallQuestion[]>(() => {
    const byId = new Map(words.map(w => [w.id, w]))
    const eligible = eligibleGroups(groups, byId, progress)
    // Recently seen prompts are demoted behind unseen ones — the same
    // windowing the passage picker uses (the one surface the repetition
    // audit measured at 0% repeats). The window scales with the eligible
    // pool so something always stays fresh to draw. Anything marked 巩固
    // last time jumps ahead of both.
    const recent = storage.get<string[]>('recentRecall') ?? []
    const seen = new Set(recent.slice(0, recentWindow(eligible.length)))
    const debt = new Set(storage.get<string[]>('recallDebt') ?? [])
    return generateRecallSession(groups, byId, progress, today, seen, debt, QUESTION_COUNT, Math.random)
  })
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])
  const [misses, setMisses] = useState<Record<string, Miss>>({})
  const [reinforced, setReinforced] = useState<Set<string>>(new Set())
  /**
   * Questions to re-ask once the scored round is over. **Not scored** — the
   * score is out of the ten questions the round actually asked, and a
   * re-drill that could raise it would make 巩固 a way to buy points.
   */
  const [encore, setEncore] = useState<RecallQuestion[]>([])
  const [encoreIndex, setEncoreIndex] = useState(0)
  const recordedRef = useRef(false)
  const nextGuardRef = useRef(false)

  const total = questions.length
  const scoredDone = index >= total && total > 0
  const inEncore = scoredDone && encoreIndex < encore.length
  const done = scoredDone && !inEncore

  const handleAnswered = useCallback((correct: boolean, ids: string[], miss: Miss | null, q: RecallQuestion) => {
    // Seen means answered, not generated: quitting a session halfway must
    // not mark the unreached prompts as stale.
    storage.set('recentRecall', pushRecent(storage.get<string[]>('recentRecall') ?? [], q.prompt))
    if (correct) {
      // Answering it right is the only thing that clears the debt — that is
      // what "巩固" was asking for in the first place.
      const debt = storage.get<string[]>('recallDebt') ?? []
      if (debt.includes(q.prompt)) storage.set('recallDebt', debt.filter(p => p !== q.prompt))
      setScore(s => s + 1)
      return
    }
    setWrongIds(prev => [...new Set([...prev, ...ids])])
    if (miss !== null) setMisses(prev => ({ ...prev, [q.orderIds[0]]: miss }))
  }, [])

  /**
   * 巩固: practise this **direction** again, which is the one thing pulling
   * the due date forward cannot do — /review's card is headword-front, so a
   * meaning→headword miss would come back as headword→meaning. So it does
   * three things at once, all one intent:
   *   1. re-asks the same question after the scored round (immediate),
   *   2. remembers the prompt so the next 回想 session opens on it (spaced),
   *   3. counts the lapse via consolidateWord (bookkeeping — it was a real miss).
   */
  const reinforce = useCallback((q: RecallQuestion) => {
    consolidateWord(q.orderIds[0])
    setReinforced(prev => new Set(prev).add(q.prompt))
    setEncore(prev => prev.some(e => e.prompt === q.prompt) ? prev : [...prev, q])
    storage.set('recallDebt', pushRecent(storage.get<string[]>('recallDebt') ?? [], q.prompt))
  }, [consolidateWord])

  const handleNext = useCallback(() => {
    if (nextGuardRef.current) return
    nextGuardRef.current = true
    if (index >= total) setEncoreIndex(i => i + 1)
    else setIndex(i => i + 1)
  }, [index, total])

  useEffect(() => {
    nextGuardRef.current = false
  }, [index, encoreIndex])

  // Settlement fires when the **scored** round ends, not when the re-drill
  // does: the re-drill is practice appended after the fact, and holding the
  // write back until it finished would lose the round if the user walked
  // away mid-drill.
  useEffect(() => {
    if (scoredDone && !recordedRef.current) {
      recordedRef.current = true
      recordQuiz(score, total, wrongIds, 'recall')
    }
  }, [scoredDone, score, total, wrongIds, recordQuiz])

  const wordsById = useMemo(() => new Map(words.map(w => [w.id, w])), [words])

  if (total === 0) {
    return (
      <Card className="quiz-empty">
        <p>
          你学过的词里还凑不出可以回想的一组。回想只考已经学过的近义词组 ——
          一组里哪怕有一个词没学过,排它就没有意义。再学一阵子,这里的题会自己多起来。
        </p>
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
                    {/* Which kind of miss it was, carried through to the
                        summary: "the meaning was there, the word wasn't" is
                        a different diagnosis from "nothing came", and the
                        list is where you decide what to do about it. */}
                    {misses[w.id] !== undefined ? (
                      <span className="quiz-option__tag">{MISS_TAG[misses[w.id]]}</span>
                    ) : null}
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

  const q = inEncore ? encore[encoreIndex] : questions[index]
  const isLast = inEncore
    ? encoreIndex === encore.length - 1
    : index === total - 1 && encore.length === 0

  return (
    <>
      <div className="quiz-progress">
        <div
          className="progress"
          role="progressbar"
          aria-label={inEncore ? '巩固进度' : '测试进度'}
          aria-valuemin={0}
          aria-valuemax={inEncore ? encore.length : total}
          aria-valuenow={inEncore ? encoreIndex : index}
          aria-valuetext={
            inEncore
              ? `巩固 第 ${encoreIndex + 1} / ${encore.length} 题`
              : `第 ${index + 1} / ${total} 题`
          }
        >
          <div
            className="progress__fill"
            style={{ width: `${((inEncore ? encoreIndex : index) / (inEncore ? encore.length : total)) * 100}%` }}
          />
        </div>
        <p className="muted num quiz-progress__count">
          {inEncore
            ? `巩固 · 第 ${encoreIndex + 1} / ${encore.length} 题`
            : `第 ${index + 1} / ${total} 题`}
        </p>
      </div>
      <Card>
        <RecallQuestionView
          key={inEncore ? `encore-${encoreIndex}` : index}
          question={q}
          onAnswered={(correct, ids, miss) => handleAnswered(correct, ids, miss, q)}
          onNext={handleNext}
          nextLabel={isLast ? '查看成绩' : '下一题'}
          onReinforce={inEncore ? undefined : reinforce}
          reinforced={reinforced.has(q.prompt)}
        />
      </Card>
    </>
  )
}
