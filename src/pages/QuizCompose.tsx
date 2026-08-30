import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ExampleSentence } from '../components/ExampleSentence'
import { TextInput } from '../components/TextInput'
import { isEditableTarget, optionIndexFromKey } from '../lib/keys'
import { pushRecent, recentWindow } from '../lib/passage'
import type { RecallSentence } from '../lib/recallSentence'
import type { SenseGroup } from '../lib/senseGroup'
import {
  generateComposeSession,
  gradeOrder,
  gradeWord,
  missedIds,
  usableChunks,
} from '../lib/sentenceChunk'
import type { ChunkAnnotation, ComposeQuestion, OrderVerdict, WordVerdict } from '../lib/sentenceChunk'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { storage } from '../lib/storage'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import type { Word } from '../types'

/**
 * 组句 — order the meaning chunks, then supply the word that was taken out.
 *
 * **Six questions, not ten.** Ordering five chunks and typing a word runs
 * 30–60s against a few seconds for a four-choice question; ten of these is
 * 短文's session length, not a daily mode's.
 *
 * **One submit, no retry.** Chunks can be taken back out and rearranged
 * freely up to that point, and then the question is settled. This is the
 * sharpest divergence from the word-bank exercise this resembles, which
 * grades the moment the row fills and so permits unlimited trial and error.
 *
 * See docs/superpowers/specs/2026-08-30-sentence-compose-design.md.
 */

const QUESTION_COUNT = 6

/**
 * How a question came out, for the results list.
 *
 * The two axes are kept apart all the way to the summary because they ask
 * for different things: 词错了 sends you to the word, 顺序错了 sends you to
 * the sentence, and 词形错了 says the word is already yours and only the
 * grammar slipped. Collapsing them into one "wrong" would report all three
 * as the same finding — the mistake 回想's four miss kinds exist to avoid.
 */
const MISS_TAG: Record<string, string> = {
  word: '词没出来',
  form: '词形错了',
  order: '顺序错了',
  both: '词和顺序都错',
}

const missKind = (order: OrderVerdict, word: WordVerdict): string | null => {
  if (word === 'wrong') return order === 'wrong' ? 'both' : 'word'
  if (word === 'form') return 'form'
  return order === 'wrong' ? 'order' : null
}

interface ComposeQuestionViewProps {
  question: ComposeQuestion
  onAnswered: (order: OrderVerdict, word: WordVerdict) => void
  onNext: () => void
  nextLabel: string
}

function ComposeQuestionView({ question, onAnswered, onNext, nextLabel }: ComposeQuestionViewProps) {
  const { progress, words } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)
  /** Pool indices in slot order. The pool itself never reorders, so the printed shortcuts stay put. */
  const [placed, setPlaced] = useState<number[]>([])
  const [typed, setTyped] = useState('')
  const [verdict, setVerdict] = useState<{ order: OrderVerdict; word: WordVerdict } | null>(null)
  const answeredRef = useRef(false)
  const nextRef = useRef<HTMLButtonElement>(null)

  const word = useMemo(() => words.find(w => w.id === question.id), [words, question.id])
  const slots = question.chunks.length
  const ready = placed.length === slots && typed.trim() !== ''

  const toggle = useCallback((poolIndex: number) => {
    if (answeredRef.current) return
    setPlaced(prev => prev.includes(poolIndex)
      ? prev.filter(k => k !== poolIndex)
      : (prev.length >= slots ? prev : [...prev, poolIndex]))
  }, [slots])

  const submit = useCallback(() => {
    if (answeredRef.current || !ready || word === undefined) return
    answeredRef.current = true
    const order = gradeOrder(placed.map(k => question.pool[k]), question.chunks)
    const w = gradeWord(typed, word, question.answer)
    setVerdict({ order, word: w })
    // Fired inside the tap's own call stack: iOS only unlocks audio there.
    playQuizResult(order === 'ok' && w === 'ok', soundEnabled)
    onAnswered(order, w)
  }, [ready, word, placed, typed, question, soundEnabled, onAnswered])

  useEffect(() => {
    if (verdict !== null) nextRef.current?.focus()
  }, [verdict])

  /**
   * Digits place chunks, and the digit is printed on every chip — an
   * undocumented shortcut does not exist. `isEditableTarget` is what makes
   * this safe to have alongside a text field: once focus is in the word
   * input, a digit is a digit.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (verdict !== null) return
      if (isEditableTarget(document.activeElement)) return
      const k = optionIndexFromKey(e, question.pool.length)
      if (k === -1) return
      e.preventDefault()
      toggle(k)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [verdict, question.pool.length, toggle])

  const t = question.target
  const at = t === undefined ? -1 : question.prompt.indexOf(t)
  const prompt = t !== undefined && at !== -1 ? (
    <>
      {question.prompt.slice(0, at)}
      <em className="recall-target">{t}</em>
      {question.prompt.slice(at + t.length)}
    </>
  ) : question.prompt

  const revealed = verdict !== null

  return (
    <div>
      <p className="quiz-q__label">读中文,拼出英文句子,并补上空缺的词</p>
      <p className="quiz-q__prompt">{prompt}</p>

      <ol className="compose-slots" aria-label="你拼出的句子">
        {Array.from({ length: slots }, (_, s) => {
          const k = placed[s]
          const filled = k !== undefined
          const right = revealed && filled && question.pool[k] === question.chunks[s]
          return (
            <li key={s} className="compose-slot__item">
              <button
                type="button"
                className={`compose-slot${filled ? ' compose-slot--filled' : ''}${
                  revealed ? (right ? ' compose-slot--right' : ' compose-slot--wrong') : ''
                }`}
                disabled={!filled || revealed}
                onClick={() => filled && toggle(k)}
                aria-label={filled ? `第 ${s + 1} 格:${question.pool[k]},点击取出` : `第 ${s + 1} 格,空`}
              >
                <span lang="en">{filled ? question.pool[k] : ' '}</span>
                {/* The sentence-final punctuation rides the last *slot*, not
                    the chunk that lands in it. Keeping it out of the chunks is
                    what stops it marking which chunk goes last; keeping it on
                    the final position is what stops it orphaning onto a line
                    of its own, which is what a separate item did once the
                    slots started wrapping one to a row at 375px. */}
                {s === slots - 1 && question.tail !== '' && (
                  <span className="compose-tail" lang="en">{question.tail}</span>
                )}
              </button>
            </li>
          )
        })}
      </ol>

      {/* Gone once the question is settled. The slots hold what was built and
          the reference sentence below holds the answer, so a pool left on
          screen only doubles the card's height — and the one chip still
          undimmed would be the distractor, reading as a control nobody
          answered. */}
      {!revealed && (
      <ul className="compose-pool" aria-label="可用的意群块">
        {question.pool.map((text, k) => (
          <li key={k}>
            <button
              type="button"
              className={`chip compose-chunk${placed.includes(k) ? ' compose-chunk--used' : ''}`}
              disabled={revealed || placed.includes(k)}
              onClick={() => toggle(k)}
            >
              <span className="compose-chunk__key num" aria-hidden="true">{k + 1}</span>
              <span lang="en">{text}</span>
            </button>
          </li>
        ))}
      </ul>
      )}

      <label className="compose-word">
        <span className="quiz-q__label">空缺的词</span>
        <TextInput
          value={typed}
          lang="en"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          disabled={revealed}
          placeholder="把空缺处的英文词打出来"
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />
      </label>

      {!revealed ? (
        <Button className="quiz-q__next" variant="primary" block disabled={!ready} onClick={submit}>
          提交 · Enter
        </Button>
      ) : (
        <>
          {/* Two verdicts side by side, each spelling its result out. The
              colour is a second channel, never the only one. */}
          <p className="compose-verdicts" role="status">
            <span className={`compose-verdict compose-verdict--${verdict.order === 'ok' ? 'ok' : 'bad'}`}>
              顺序 {verdict.order === 'ok' ? '正确' : '错误'}
            </span>
            <span className={`compose-verdict compose-verdict--${verdict.word === 'ok' ? 'ok' : 'bad'}`}>
              词 {verdict.word === 'ok' ? '正确' : verdict.word === 'form' ? '词形错了' : '错误'}
            </span>
          </p>
          {verdict.word === 'form' && (
            <p className="compose-note">
              词是对的,形不对 —— 这句要的是 <strong lang="en">{question.answer}</strong>。
            </p>
          )}
          <p className="recall-en" lang="en">
            <ExampleSentence sentence={question.en} headword={question.headword} />
          </p>
          {question.gloss !== undefined && <p className="recall-why">{question.headword} · {question.gloss}</p>}
          <Button ref={nextRef} className="quiz-q__next" variant="primary" block onClick={onNext}>
            {nextLabel}
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * One round of 组句. Same session skeleton as the other modes — question set
 * pinned once, remount to restart, `recordQuiz` exactly once at settlement.
 */
export function ComposeSession({
  words,
  annotations,
  groups,
  sentences,
  onRestart,
}: {
  words: Word[]
  annotations: ChunkAnnotation[]
  groups: SenseGroup[]
  sentences: RecallSentence[]
  onRestart: () => void
}) {
  const { progress, recordQuiz } = useApp()
  // Pinned alongside the question set: difficultyWeight's recent-miss window
  // reads it, and a session must not change meaning because the clock rolled
  // past midnight partway through.
  const [today] = useState(() => todayStr(new Date()))

  const [questions] = useState<ComposeQuestion[]>(() => {
    const byId = new Map(words.map(w => [w.id, w]))
    const poolSize = usableChunks(annotations, byId, groups, progress).length
    const recent = storage.get<string[]>('recentCompose') ?? []
    const seen = new Set(recent.slice(0, recentWindow(poolSize)))
    return generateComposeSession(
      annotations, byId, groups, sentences, progress, today, seen, QUESTION_COUNT, Math.random,
    )
  })
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [results, setResults] = useState<{ id: string; word: WordVerdict; kind: string | null }[]>([])
  const recordedRef = useRef(false)
  const nextGuardRef = useRef(false)

  const total = questions.length
  const done = index >= total && total > 0

  const handleAnswered = useCallback((order: OrderVerdict, word: WordVerdict, q: ComposeQuestion) => {
    // Seen means answered, not generated: quitting halfway must not mark the
    // prompts you never reached as stale.
    storage.set('recentCompose', pushRecent(storage.get<string[]>('recentCompose') ?? [], q.prompt))
    setResults(prev => [...prev, { id: q.id, word, kind: missKind(order, word) }])
    // A question counts as correct only when both axes are — the mode's
    // question is "can you build this sentence", and half of it is not it.
    if (order === 'ok' && word === 'ok') setScore(s => s + 1)
  }, [])

  const handleNext = useCallback(() => {
    if (nextGuardRef.current) return
    nextGuardRef.current = true
    setIndex(i => i + 1)
  }, [])

  useEffect(() => { nextGuardRef.current = false }, [index])

  useEffect(() => {
    if (done && !recordedRef.current) {
      recordedRef.current = true
      // Only a wrong *word* is reported as a miss. A wrong order is a syntax
      // slip, and pushing it through demoteWord would move this word's
      // interval on a signal that is not about this word — see missedIds.
      recordQuiz(score, total, missedIds(results), 'compose')
    }
  }, [done, score, total, results, recordQuiz])

  const wordsById = useMemo(() => new Map(words.map(w => [w.id, w])), [words])

  if (total === 0) {
    return (
      <Card className="quiz-empty">
        <p>
          你学过的词里还没有可以组句的。组句只考已经切好意群的句子 ——
          切块是手写的内容,还在一批一批补。再学一阵子,或者等下一批内容,这里的题会多起来。
        </p>
        <Link className="btn btn--primary" to="/library">
          去词库看看
        </Link>
      </Card>
    )
  }

  if (done) {
    const missed = results.filter(r => r.kind !== null)
    return (
      <>
        <Card>
          <p className="quiz-result__score" role="status">
            <span className="num quiz-result__score-num">{score}</span>
            <span className="muted"> / {total}</span>
          </p>
          <p className="muted quiz-result__summary">
            {score === total ? '全部答对,漂亮!' : `本轮测了 ${total} 题,顺序和词都对的有 ${score} 题。`}
          </p>
        </Card>

        {missed.length > 0 ? (
          <Card pad="none">
            <p className="quiz-q__label quiz-wrong-title">没拿下的 · {missed.length}</p>
            <ul className="quiz-wrong-list">
              {missed.map((r, k) => {
                const w = wordsById.get(r.id)
                if (w === undefined) return null
                return (
                  <li key={`${r.id}-${k}`}>
                    <Link className="quiz-wrong-list__item" to={`/word/${w.id}`}>
                      <span className="word" lang="en">{w.headword}</span>
                      <span className="muted">{w.meanings[0]?.zh}</span>
                      <span className="quiz-option__tag">{MISS_TAG[r.kind as string]}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>
        ) : null}

        <div className="quiz-result__actions">
          <Button variant="primary" size="lg" block onClick={onRestart}>再测一轮</Button>
          <Link className="btn btn--secondary btn--block" to="/">返回今日</Link>
        </div>
      </>
    )
  }

  const q = questions[index]
  return (
    <>
      <div className="quiz-progress">
        <div
          className="progress"
          role="progressbar"
          aria-label="测试进度"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
          aria-valuetext={`第 ${index + 1} / ${total} 题`}
        >
          <div className="progress__fill" style={{ width: `${(index / total) * 100}%` }} />
        </div>
        <p className="muted num quiz-progress__count">第 {index + 1} / {total} 题</p>
      </div>
      <Card>
        <ComposeQuestionView
          key={index}
          question={q}
          onAnswered={(order, word) => handleAnswered(order, word, q)}
          onNext={handleNext}
          nextLabel={index === total - 1 ? '查看成绩' : '下一题'}
        />
      </Card>
    </>
  )
}
