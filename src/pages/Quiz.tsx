import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { pushRecent } from '../lib/passage'
import { preparePronunciation } from '../lib/pronounce'
import { contrastPairKey, generateAudioQuiz, generateContrastQuiz, generateQuiz } from '../lib/quiz'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import type { QuizMetricKey, QuizQuestion } from '../lib/quiz'
import type { Passage } from '../lib/passage'
import type { SenseGroup } from '../lib/senseGroup'
import { useApp } from '../state/store'
import type { Progress, Word } from '../types'
import { agoLabel, modeOverview, recommendMode } from './statsDerive'
import type { ModeOverviewRow } from './statsDerive'
import { QuizQuestionView } from './QuizQuestion'
import { GuessMode } from './Guess'
import { PassageSession } from './QuizPassage'
import { RecallSession } from './QuizRecall'
import { SprintSession } from './QuizSprint'
import './Quiz.css'

const QUESTION_COUNT = 10

/**
 * The seven practice surfaces. `?mode=` drives which one renders,
 * consistent with `/review?mode=lapses`; `/quiz` with no (or an unknown)
 * mode renders the hub.
 *
 * **This reverses the old "defaults to mixed, zero extra clicks" rule.**
 * That comment was written at four modes; at seven, the chip row had
 * stopped carrying information — no descriptions, no per-mode stats,
 * nothing marking a neglected mode. Sketch 002 (winner B) trades exactly
 * one tap for making the seven modes comparable at a glance; the mixed
 * card spans full width at the top so the every-day default stays the
 * largest, first target.
 */
const MODES = [
  { key: 'mixed', label: '综合', desc: '中英互认 + 例句填空,日常主力' },
  { key: 'recall', label: '回想', desc: '只看中文,回想英文词' },
  { key: 'contrast', label: '辨析', desc: '易混词对二选一' },
  { key: 'audio', label: '听音', desc: '听发音,选词义' },
  { key: 'sprint', label: '极速', desc: '60 秒,能答多少答多少' },
  { key: 'passage', label: '短文', desc: '整段文章挖空填词' },
  { key: 'guess', label: '猜词', desc: '按释义逐步猜出单词' },
] as const

type QuizMode = (typeof MODES)[number]['key']

const MODE_LABEL: Record<QuizMode, string> = Object.fromEntries(MODES.map(m => [m.key, m.label])) as Record<QuizMode, string>

const isMode = (v: string | null): v is QuizMode => MODES.some(m => m.key === v)

/** Explanation for when no questions can be generated: each mode is missing something different, and one generic message would leave people not knowing what to do. */
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint' | 'passage' | 'recall' | 'guess'>, string> = {
  mixed: '需要至少 4 个词条才能测试。当前词库还不够,先去添加或多学几个单词吧。',
  contrast: '你学过的词里还凑不出易混的一对。辨析只考已经学过的词 —— 拿两个没见过的词问「该用哪个」没有意义。再学一阵子,这里的题会自己多起来。',
  audio: '需要至少 4 个词条才能开始听音练习。当前词库还不够,先去添加或多学几个单词吧。',
}

/**
 * All the state for one round of quizzing. "Test again" is implemented by
 * deliberately swapping out this component itself via `key` (see the end
 * of Quiz()), rather than adding an internal reset branch — questions,
 * score, and answered state are all zeroed out by remounting, with no
 * field to clear by hand and nothing to accidentally miss.
 */
function QuizSession({
  words,
  mode,
  onRestart,
}: {
  words: Word[]
  mode: Exclude<QuizMode, 'sprint' | 'passage' | 'recall' | 'guess'>
  onRestart: () => void
}) {
  const { progress, recordQuiz } = useApp()
  // Pinned once, alongside the question set: difficultyWeight's recent-miss
  // window reads it, and a session must not change meaning midway because
  // the clock rolled past midnight.
  const [today] = useState(() => todayStr(new Date()))

  // Generated only once, on mount: all three generator functions default to
  // Math.random under the hood, so calling them again during a re-render
  // would silently swap out the question set mid-quiz. A lazy initial value
  // with no dependency on any state guarantees this round uses the same
  // question set start to finish.
  const [questions] = useState<QuizQuestion[]>(() => {
    if (mode === 'contrast') {
      // The recency list demotes recently asked pairs behind unseen ones —
      // see the window comment in generateContrastQuiz. Stored locally like
      // recentPassages; never synced.
      return generateContrastQuiz(
        words, progress, QUESTION_COUNT, Math.random,
        storage.get<string[]>('recentContrast') ?? [],
      )
    }
    if (mode === 'audio') return generateAudioQuiz(words, progress, today, QUESTION_COUNT)
    return generateQuiz(words, progress, today, QUESTION_COUNT)
  })
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [wrongIds, setWrongIds] = useState<string[]>([])

  // Warm every audio question's recording at session start rather than per
  // card. The per-card prepare only begins the moment that card mounts —
  // which is the same moment its auto-play fires, so it can never win that
  // race. Warming the whole set here means questions after the first play
  // the human recording, not the server voice. (`questions` is fixed for
  // the session — see the lazy initializer above — so this runs once.)
  useEffect(() => {
    if (mode !== 'audio') return
    for (const q of questions) preparePronunciation(q.prompt)
  }, [mode, questions])
  // recordQuiz should only ever fire once, at the moment the results page
  // is reached; no subsequent re-render (e.g. a global state update
  // triggered by recordQuiz itself) may fire it a second time.
  const recordedRef = useRef(false)
  // Double-click/repeat-click guard for "Next question", the same pattern
  // as answeredRef in QuizQuestion.tsx: set synchronously to block the
  // second click, rather than waiting for the disabled attribute to take
  // effect on the next render. Re-unlocked when index changes (see the
  // effect below), otherwise the next question would never be clickable
  // again.
  const nextGuardRef = useRef(false)

  const total = questions.length
  const done = index >= total && total > 0

  const handleAnswered = useCallback((correct: boolean, q: QuizQuestion) => {
    // Answered means seen: the pair joins the recency list whichever way it
    // went, so tomorrow's round reaches for pairs this one never showed.
    if (q.contrastId !== undefined) {
      storage.set('recentContrast', pushRecent(
        storage.get<string[]>('recentContrast') ?? [],
        contrastPairKey(q.wordId, q.contrastId),
      ))
    }
    if (correct) { setScore(s => s + 1); return }
    // A missed contrast question marks **both** words wrong. Picking the
    // wrong twin is not a fact about one word — the confusion lives in the
    // pair, and pulling only the answer's due date forward would leave the
    // word actually chosen (the misunderstood one) unreinforced. Deduped
    // because the same word can sit in several pairs within one round.
    const ids = q.contrastId !== undefined ? [q.wordId, q.contrastId] : [q.wordId]
    setWrongIds(prev => [...new Set([...prev, ...ids])])
  }, [])

  const handleNext = useCallback(() => {
    if (nextGuardRef.current) return
    nextGuardRef.current = true
    setIndex(i => i + 1)
  }, [])

  useEffect(() => {
    nextGuardRef.current = false
  }, [index])

  useEffect(() => {
    if (done && !recordedRef.current) {
      recordedRef.current = true
      recordQuiz(score, total, wrongIds, mode)
    }
  }, [done, score, total, wrongIds, recordQuiz, mode])

  const wordsById = useMemo(() => new Map(words.map(w => [w.id, w])), [words])

  if (total === 0) {
    return (
      <Card className="quiz-empty">
        <p>{EMPTY_HINT[mode]}</p>
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

  const q = questions[index]
  const isLast = index === total - 1

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
        <p className="muted num quiz-progress__count">
          第 {index + 1} / {total} 题
        </p>
      </div>
      <Card>
        <QuizQuestionView
          key={index}
          question={q}
          onAnswered={correct => handleAnswered(correct, q)}
          onNext={handleNext}
          nextLabel={isLast ? '查看成绩' : '下一题'}
        />
      </Card>
    </>
  )
}

/**
 * Router: the mode param decides hub or session. Two separate components
 * rather than one branching render — hub and session own different hook
 * sets (the session loads passages/sense-groups), and a single component
 * switching between them would change its hook count between renders.
 */
export function Quiz() {
  const [params] = useSearchParams()
  const raw = params.get('mode')
  return isMode(raw) ? <QuizSessionPage mode={raw} /> : <QuizHub />
}

/** Card line: sprint and guess chase a personal best, the rest show accuracy once it clears the floor. */
function statLabel(key: QuizMetricKey, row: ModeOverviewRow | undefined, progress: Progress): string {
  if (key === 'sprint' && progress.bestSprint !== undefined) return `最高 ${progress.bestSprint.score} 题`
  if (key === 'guess' && progress.bestGuess !== undefined) return `最佳 ${progress.bestGuess.score} 词`
  if (row === undefined || row.asked === 0) return '—'
  if (row.rate === null) return `练过 ${row.asked} 题`
  return `${Math.round(row.rate * 100)}%`
}

function QuizHub() {
  const { progress } = useApp()
  const today = todayStr(new Date())
  const rows = useMemo(() => modeOverview(progress), [progress])
  const rec = useMemo(() => recommendMode(rows), [rows])
  const byKey = useMemo(() => new Map(rows.map(r => [r.mode, r])), [rows])

  return (
    <Page eyebrow="Quiz" title="测试" back="/">
      <div className="quiz-hub">
        {MODES.map(m => {
          const row = byKey.get(m.key)
          return (
            <Link
              key={m.key}
              to={`/quiz?mode=${m.key}`}
              className={`card card--interactive quiz-mode-card${m.key === 'mixed' ? ' quiz-mode-card--wide' : ''}`}
            >
              {rec === m.key && <span className="quiz-mode-card__badge">推荐</span>}
              <p className="quiz-mode-card__name">{m.label}</p>
              <p className="quiz-mode-card__desc">{m.desc}</p>
              <p className="quiz-mode-card__meta">
                <span className={`num quiz-mode-card__stat${rec === m.key ? ' quiz-mode-card__stat--low' : ''}`}>
                  {statLabel(m.key, row, progress)}
                </span>
                <span className="quiz-mode-card__ago">{agoLabel(row?.lastPlayed ?? null, today)}</span>
              </p>
            </Link>
          )
        })}
      </div>
    </Page>
  )
}

/**
 * Task 18 implementation: 10 multiple-choice/spelling questions, instant
 * right/wrong feedback, a results page.
 *
 * Handling of leaving the page: an incomplete quiz is never persisted —
 * navigating away just unmounts QuizSession, and re-entering the mode
 * counts as starting a fresh round. recordQuiz only ever fires once, at
 * the moment all questions are actually answered and the results page is
 * reached; leaving partway through leaves no trace and never counts a
 * "half-finished" attempt as today's quiz.
 */
function QuizSessionPage({ mode }: { mode: QuizMode }) {
  const { words } = useApp()
  const [session, setSession] = useState(0)

  // The content is only fetched once you actually enter passage mode. It's
  // static content shipped with the app, split into a separate chunk via
  // import() so the four everyday modes don't have to download an extra
  // few dozen KB for it.
  const [passages, setPassages] = useState<Passage[] | null>(null)
  useEffect(() => {
    if (mode !== 'passage' || passages !== null) return
    let alive = true
    void import('../data/passages.json').then(m => {
      if (alive) setPassages((m.default as { passages: Passage[] }).passages)
    })
    return () => { alive = false }
  }, [mode, passages])

  // Sense groups get the same treatment and the same reasoning as passages.
  const [groups, setGroups] = useState<SenseGroup[] | null>(null)
  useEffect(() => {
    if (mode !== 'recall' || groups !== null) return
    let alive = true
    void import('../data/senseGroups.json').then(m => {
      if (alive) setGroups((m.default as { groups: SenseGroup[] }).groups)
    })
    return () => { alive = false }
  }, [mode, groups])

  const restart = useCallback(() => setSession(s => s + 1), [])

  return (
    <Page eyebrow="Quiz" title={MODE_LABEL[mode]} back="/quiz">
      {/* mode is folded into the key: switching modes must swap in a whole
          new round of questions, rather than stuffing new questions into
          the old session's question numbering. This is the same technique
          as "test again" (zeroing out via remount, not clearing fields one
          by one). */}
      {mode === 'sprint' ? (
        <SprintSession key={`sprint-${session}`} words={words} onRestart={restart} />
      ) : mode === 'guess' ? (
        // GuessMode owns its own round counter and question generation, so
        // it needs no key and no onRestart — the one mode that predates the
        // switcher and kept its internals when its chrome moved here.
        <GuessMode />
      ) : mode === 'recall' ? (
        groups === null ? (
          <Card className="quiz-empty"><p className="muted">正在加载题组…</p></Card>
        ) : (
          <RecallSession
            key={`recall-${session}`}
            words={words}
            groups={groups}
            onRestart={restart}
          />
        )
      ) : mode === 'passage' ? (
        passages === null ? (
          <Card className="quiz-empty"><p className="muted">正在加载短文…</p></Card>
        ) : (
          <PassageSession
            key={`passage-${session}`}
            words={words}
            passages={passages}
            onRestart={restart}
          />
        )
      ) : (
        <QuizSession key={`${mode}-${session}`} words={words} mode={mode} onRestart={restart} />
      )}
    </Page>
  )
}
