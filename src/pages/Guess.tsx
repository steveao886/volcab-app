import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import wordNotesFile from '../data/wordNotes.json'
import { classifyGuess, generateGuessSession, scoreWord, WORD_START_SCORE } from '../lib/guess'
import type { ClueKind, GuessQuestion, GuessVerdict } from '../lib/guess'
import { isSoundEnabled, playQuizResult, playSessionDone } from '../lib/sound'
import type { WordNotesFile } from '../lib/wordNotes'
import { useApp } from '../state/store'
import './Guess.css'

/**
 * 猜词 — the only mode that asks you to produce the word.
 *
 * Its own page rather than a sixth entry in /quiz: every mode there is
 * "tap one of four and it locks", and this is a text field plus a shop you
 * spend points in. QuizSprint and QuizPassage each went their own way for
 * the same reason, and the precedent sits right beside them.
 *
 * All the judgment lives in lib/guess.ts. This file owns session state and
 * paints what it is handed.
 */

const QUESTION_COUNT = 10

const CLUE_LABEL: Record<ClueKind, string> = {
  pos: '词性',
  note: '要点',
  collocation: '搭配',
  etymology: '词源',
  example: '例句',
  initial: '首字母',
}

interface Result { id: string; headword: string; score: number; unaided: boolean; solved: boolean }

function GuessSession({ questions, onRestart }: { questions: GuessQuestion[]; onRestart: () => void }) {
  const { recordGuess, progress, words } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)

  // Snapshot before settlement: recordGuess updates progress.bestGuess in
  // place, so comparing afterwards would always read as a tie.
  const [prevBest] = useState(() => progress.bestGuess)

  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [bought, setBought] = useState<ClueKind[]>([])
  const [verdict, setVerdict] = useState<GuessVerdict | null>(null)
  const [settled, setSettled] = useState<'solved' | 'revealed' | null>(null)
  const [results, setResults] = useState<Result[]>([])
  /**
   * Whether the round is over, as its own flag rather than "index has run
   * past the end". It used to be the latter, and reading questions[index]
   * with index === questions.length gave undefined — which the very next
   * line dereferenced, so pressing 结算 after buying a clue on the last
   * question took the whole page down. tsconfig.app.json leaves
   * noUncheckedIndexedAccess off, so the type said the element was always
   * there and nothing caught it.
   */
  const [finished, setFinished] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  // Every headword in the library, for telling a typo apart from a different
  // word (see classifyGuess). Built once per session, not per keystroke.
  const libraryWords = useMemo(
    () => new Set(words.map(w => w.headword.trim().toLowerCase())),
    [words],
  )

  const finish = useCallback((outcome: 'solved' | 'revealed', q: GuessQuestion) => {
    // Played inside the click's own call stack — iOS only unlocks the
    // AudioContext within a user gesture, the same rule QuizQuestion follows.
    playQuizResult(outcome === 'solved', soundEnabled)
    setSettled(outcome)
    setResults(rs => [...rs, {
      id: q.id,
      headword: q.headword,
      score: scoreWord(bought, outcome),
      unaided: outcome === 'solved' && bought.length === 0,
      solved: outcome === 'solved',
    }])
  }, [bought, soundEnabled])

  /**
   * Focus follows the question: the box while you are answering, 下一题 once
   * you are not.
   *
   * Both halves have to happen in an effect, after the render that mounts
   * the control. next() used to call inputRef.current.focus() directly, but
   * at that moment the settled branch is still on screen and the input is
   * unmounted, so the ref was null and the call did nothing — every question
   * after the first landed with the caret nowhere and had to be clicked into.
   *
   * Giving 下一题 the focus is also what makes Space and Enter advance,
   * natively, without this page grabbing either key from window — a global
   * listener would fire a second time against the already-focused button.
   */
  useEffect(() => {
    if (settled === null) inputRef.current?.focus()
    else nextRef.current?.focus()
  }, [settled, index])

  if (finished) {
    const total = results.reduce((n, r) => n + r.score, 0)
    const unaided = results.filter(r => r.unaided).length
    const beaten = prevBest === undefined || unaided > prevBest.score
    return (
      <Page eyebrow="Guess" title="这一轮结束">
        <Card className="guess-summary">
          <p className="guess-summary__score">
            <span className="num">{total}</span>
            <span className="faint"> / {questions.length * WORD_START_SCORE}</span>
          </p>
          <p className="guess-summary__unaided">
            零线索答出 <span className="num">{unaided}</span> 个
          </p>
          {/* The record is the honest scoreboard here: the session score
              moves with which words came up and how freely the shop was
              used, but an unaided solve only happens when the word is
              actually in your head. */}
          <p className={beaten ? 'guess-summary__record' : 'faint'}>
            {beaten
              ? unaided > 0 ? '新纪录' : '还没有零线索的记录'
              : `历史最好 ${prevBest.score} 个(${prevBest.date})`}
          </p>
        </Card>

        <Card>
          <ul className="guess-recap">
            {results.map(r => (
              <li key={r.id} className="guess-recap__row">
                <Link to={`/word/${r.id}`} lang="en" className="guess-recap__word">{r.headword}</Link>
                {/* A text tag, not colour alone — the palette must never be
                    the only thing carrying correctness. */}
                <span className="guess-recap__tag">
                  {r.unaided ? '零线索' : r.solved ? '用了线索' : '看了答案'}
                </span>
                <span className="num guess-recap__score">{r.score}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Button variant="primary" block onClick={onRestart}>再来一轮</Button>
      </Page>
    )
  }

  // Only reached while a question is still on screen, so this index is
  // always in range — see the comment on `finished`.
  const q = questions[index]
  const spent = bought.reduce((n, k) => n + (q.clues.find(c => c.kind === k)?.price ?? 0), 0)
  const isLast = index + 1 >= questions.length

  function submit() {
    if (settled !== null) return
    const v = classifyGuess(input, q, libraryWords)
    if (v === 'correct') finish('solved', q)
    else {
      // A near miss and a wrong word both cost nothing, but they are
      // different problems and the message has to say which.
      playQuizResult(false, soundEnabled)
      setVerdict(v)
    }
  }

  function next() {
    if (isLast) {
      // Settle once, at the end: a word whose answer was revealed counts as
      // wrong and gets its due date pulled forward; one solved with clues
      // still counts as retrieved. recordGuess never touches ease/interval.
      playSessionDone(soundEnabled)
      recordGuess(
        results.filter(r => !r.solved).map(r => r.id),
        results.filter(r => r.unaided).length,
        results.length,
        results.filter(r => r.solved).length,
      )
      setFinished(true)
      return
    }
    setIndex(i => i + 1)
    setInput('')
    setBought([])
    setVerdict(null)
    setSettled(null)
    // Focus is not set here on purpose — the input does not exist yet at
    // this point in the render. The effect above owns it.
  }

  return (
    <Page eyebrow="Guess" title="猜词">
      <p className="guess-progress faint">
        <span className="num">{index + 1}</span> / {questions.length}
        <span className="guess-progress__points num">{WORD_START_SCORE - spent} 分</span>
      </p>

      <Card>
        <p className="guess-prompt">{q.prompt}</p>

        {settled === null ? (
          <>
            <TextInput
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setVerdict(null) }}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="把这个词打出来"
              aria-label="你的答案"
              lang="en"
              // A phone keyboard that capitalises and rewrites C1 vocabulary
              // would fight the user on every single question.
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="guess-actions">
              <Button variant="primary" onClick={submit} disabled={input.trim() === ''}>
                提交 <span className="faint">回车</span>
              </Button>
              <Button variant="ghost" onClick={() => finish('revealed', q)}>看答案(0 分)</Button>
            </div>
            {/* Near and wrong are separate messages on purpose. Being one
                letter out and reaching for the wrong word are different
                failures, and a single "不对" would hide which one happened.
                Neither costs anything, so neither is styled as a penalty. */}
            {verdict === 'near' && (
              <p className="guess-miss">就差一两个字母,拼写再看一眼。答错不扣分。</p>
            )}
            {verdict === 'wrong' && (
              <p className="guess-miss">不是这个词,再想想。答错不扣分。</p>
            )}
          </>
        ) : (
          <>
            <p className="guess-answer" lang="en">{q.headword}</p>
            <p className="guess-verdict">
              {settled === 'solved'
                ? `答对 · 这题 ${scoreWord(bought, 'solved')} 分`
                : '看了答案 · 这题 0 分'}
            </p>
            <Button ref={nextRef} variant="primary" block onClick={next}>
              {isLast ? '结算' : '下一题'} <span className="faint">空格</span>
            </Button>
          </>
        )}
      </Card>

      {/* Clues a word has no data for never render a button at all — the
          same treatment the etymology block gets on the review card. */}
      <Card>
        <p className="section-title guess-shop__title">线索</p>
        <div className="guess-shop">
          {q.clues.map(c => {
            const owned = bought.includes(c.kind)
            return (
              <div key={c.kind} className="guess-clue">
                {owned || settled !== null ? (
                  <p className="guess-clue__text">
                    <span className="guess-clue__label">{CLUE_LABEL[c.kind]}</span>
                    <span lang={c.kind === 'pos' || c.kind === 'initial' ? 'en' : undefined}>{c.text}</span>
                  </p>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setBought(b => [...b, c.kind])}>
                    {CLUE_LABEL[c.kind]} <span className="num guess-clue__price">−{c.price}</span>
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </Page>
  )
}

export function Guess() {
  const { words, progress } = useApp()
  const [round, setRound] = useState(0)

  // Regenerated only when the round counter moves, so a re-render can't
  // silently swap the question set out mid-session.
  const questions = useMemo(
    () => generateGuessSession(words, progress, (wordNotesFile as WordNotesFile).notes, QUESTION_COUNT, Math.random),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round],
  )

  if (questions.length === 0) {
    return (
      <Page eyebrow="Guess" title="猜词">
        <div className="empty-state">
          <p className="empty-state__title">还没有可以猜的词</p>
          <p className="empty-state__hint">
            猜词只考已经学过的词 —— 让你默写一个从没见过的词没有意义。先去复习几个,这里的题会自己多起来。
          </p>
          <Link className="btn btn--primary" to="/">
            去今日
          </Link>
        </div>
      </Page>
    )
  }

  return <GuessSession key={round} questions={questions} onRestart={() => setRound(r => r + 1)} />
}
