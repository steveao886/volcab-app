import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import wordNotesFile from '../data/wordNotes.json'
import { checkGuess, generateGuessSession, scoreWord, WORD_START_SCORE } from '../lib/guess'
import type { ClueKind, GuessQuestion } from '../lib/guess'
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
  const { recordGuess, progress } = useApp()

  // Snapshot before settlement: recordGuess updates progress.bestGuess in
  // place, so comparing afterwards would always read as a tie.
  const [prevBest] = useState(() => progress.bestGuess)

  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [bought, setBought] = useState<ClueKind[]>([])
  const [missed, setMissed] = useState(false)
  const [settled, setSettled] = useState<'solved' | 'revealed' | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const q = questions[index]
  const spent = bought.reduce((n, k) => n + (q.clues.find(c => c.kind === k)?.price ?? 0), 0)
  const done = results.length === questions.length

  const finish = useCallback((outcome: 'solved' | 'revealed') => {
    setSettled(outcome)
    setResults(rs => [...rs, {
      id: q.id,
      headword: q.headword,
      score: scoreWord(bought, outcome),
      unaided: outcome === 'solved' && bought.length === 0,
      solved: outcome === 'solved',
    }])
  }, [bought, q])

  function submit() {
    if (settled !== null) return
    if (checkGuess(input, q.headword)) finish('solved')
    else setMissed(true)
  }

  function next() {
    const rs = results
    if (index + 1 >= questions.length) {
      // Settle once, at the end: a word whose answer was revealed counts as
      // wrong and gets its due date pulled forward; one solved with clues
      // still counts as retrieved. recordGuess never touches ease/interval.
      recordGuess(rs.filter(r => !r.solved).map(r => r.id), rs.filter(r => r.unaided).length)
      setIndex(questions.length)   // renders the summary below
      return
    }
    setIndex(i => i + 1)
    setInput('')
    setBought([])
    setMissed(false)
    setSettled(null)
    inputRef.current?.focus()
  }

  if (done && index >= questions.length) {
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
              onChange={e => { setInput(e.target.value); setMissed(false) }}
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
                提交 ⏎
              </Button>
              <Button variant="ghost" onClick={() => finish('revealed')}>看答案(0 分)</Button>
            </div>
            {missed && <p className="guess-miss">不是这个词,再想想。答错不扣分。</p>}
          </>
        ) : (
          <>
            <p className="guess-answer" lang="en">{q.headword}</p>
            <p className="guess-verdict">
              {settled === 'solved'
                ? `答对 · 这题 ${scoreWord(bought, 'solved')} 分`
                : '看了答案 · 这题 0 分'}
            </p>
            <Button variant="primary" block onClick={next}>
              {index + 1 >= questions.length ? '结算' : '下一题'}
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
