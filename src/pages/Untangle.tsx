import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Blanked } from '../components/Blanked'
import { Button } from '../components/Button'
import { Page } from '../components/Page'
import { ProgressMarks } from '../components/ProgressMarks'
import contrastNotesFile from '../data/contrastNotes.json'
import wordNotesFile from '../data/wordNotes.json'
import { contrastNoteKey } from '../lib/contrastNotes'
import type { ContrastNotesFile } from '../lib/contrastNotes'
import { isEditableTarget, optionIndexFromKey } from '../lib/keys'
import { shuffle } from '../lib/quiz'
import { buildOrderQuestion, buildRecallQuestion, isRankable } from '../lib/senseGroup'
import type { RecallQuestion, SenseGroup, SenseGroupsFile } from '../lib/senseGroup'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { buildTangleSession, dueTangles, isReadable, pickTangle, tangleGroups } from '../lib/tangle'
import type { TangleNote, TangleQuestion } from '../lib/tangle'
import { wordNote } from '../lib/wordNotes'
import type { WordNotesFile } from '../lib/wordNotes'
import { useApp } from '../state/store'
import type { Progress, Word } from '../types'
import { RecallQuestionView } from './QuizRecall'
import { MissedWords } from './QuizResult'
import { bumpUntangleSessions, untangleSessionsToday, untangleShare } from './todayPlan'
import type { LocalMarks } from './todayPlan'
// The progress row, the drill note, the done screen and the question itself
// are borrowed from the review page, the question from 今天混过的词 there:
// see Untangle.css.
import './Review.css'
// The sense-group questions are 回想's own view, whose rules live there.
import './Quiz.css'
import './Untangle.css'

const TITLE = '拆开缠在一起的词'

/** One tangle, read once when the session opens. */
interface Opened {
  key: string
  members: Word[]
  notes: TangleNote[]
  /** In the order they are asked, shuffled once. */
  questions: TangleQuestion[]
  autoSettled: string[]
}

/**
 * The tangle this session runs, or null when none is due. Only a due tangle is
 * run (pickTangle); a stat dueTangles let through is readable, and the
 * two-member test is buildTangleSession's own answer to a word deleted since.
 *
 * **The questions are shuffled here, once.** buildTangleSession returns them
 * in member order, and the members start with the confused pair, so the first
 * question was always the very word the side by side had just listed first.
 */
function openTangle(requested: string | null, words: Word[], progress: Progress): Opened | null {
  const live = new Set(words.map((w) => w.id))
  const key = pickTangle(requested, dueTangles(progress.tangles, todayStr(new Date()), live))
  if (key === null) return null
  const stat = progress.tangles?.[key]
  if (!isReadable(stat)) return null
  const byId = new Map(words.map((w) => [w.id, w]))
  const session = buildTangleSession(stat, byId, (contrastNotesFile as ContrastNotesFile).notes)
  if (session.members.length < 2) return null
  return { key, ...session, questions: shuffle(session.questions, Math.random) }
}

// Fetched, not bundled, for the reason Quiz.tsx's loader gives, and from the
// same chunk: 327 KB that 今日 and the review page never read.
const loadGroups = () => import('../data/senseGroups.json').then((m) => (m.default as SenseGroupsFile).groups)

/**
 * The sense-group questions a session asks after its clozes (spec §3): one for
 * each group tangleGroups finds inside the members, 排序 when the group is
 * rankable and can be ranked (three or more members and no outside words),
 * otherwise 唤词. A group that can carry neither, a library too sparse to
 * fill four options, is left out. The filler pool is generateRecallSession's:
 * every learned word.
 */
function groupQuestions(
  groups: SenseGroup[], members: Word[], words: Word[], progress: Progress, rng: () => number = Math.random,
): RecallQuestion[] {
  const byId = new Map(words.map((w) => [w.id, w]))
  const fillerPool = words.filter((w) => {
    const e = progress.words[w.id]
    return e !== undefined && e.state !== 'new'
  })
  return tangleGroups(members.map((w) => w.id), groups).flatMap((g) => {
    const q = (isRankable(g, progress) ? buildOrderQuestion(g, byId, rng) : null)
      ?? buildRecallQuestion(g, byId, fillerPool, rng)
    return q === null ? [] : [q]
  })
}

/** The two members a note is about, in member order. Null for a key no pair of them makes. */
function notePair(key: string, members: Word[]): [Word, Word] | null {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (contrastNoteKey(members[i].id, members[j].id) === key) return [members[i], members[j]]
    }
  }
  return null
}

/**
 * /untangle — day 2 of a tangle (forget-moment spec §3): the members side by
 * side, the notes between them, then one cloze for each member not yet
 * settled. One tangle per session; `?key=` names it, and anything not due
 * falls back to the oldest due one.
 *
 * Each session is its own mount. 下一团 bumps `run` and names the next tangle
 * in the query (with `replace`, so the back gesture leaves the page rather
 * than walking back through finished tangles), and the key below throws the
 * finished session's state away instead of resetting it field by field.
 */
export function Untangle() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('key')
  const [run, setRun] = useState(0)
  const next = useCallback((key: string) => {
    setRun((r) => r + 1)
    setSearchParams({ key }, { replace: true })
  }, [setSearchParams])
  return <TangleSession key={`${run}:${requested ?? ''}`} requested={requested} onNext={next} />
}

type Stage = 'study' | 'ask' | 'groups' | 'end'

/**
 * Practice in CLAUDE.md's sense, and the whole of what the clozes write is one
 * recordTangle call when the last answer lands: the tangle's settled list and
 * dates, and `missedAt` on a member answered wrong. Nothing the scheduler owns
 * moves and nothing is demoted (spec §4). The session count for 今日 is written
 * at the same moment. Leaving before the last answer writes nothing, so the
 * tangle is still due and the session is owed again — rather than half a
 * session read as a whole one by applyTangleResults.
 *
 * **The sense-group questions are offered on the end screen, never put in
 * front of it**: extra practice that does not gate completion (spec §3). The
 * verdict and 下一团 come first, exactly as with no groups at all; 再练 N 道回想题
 * beside them runs the extras and comes back to the same screen. Placed
 * between the last cloze and the verdict, they kept 下一团 behind up to five
 * more questions on 53% of measured tangles (tangleGroups), and the only way
 * past one in the page was an answer, which writes a miss for a throwaway
 * pick. They come after recordTangle, so they cannot change what it receives
 * or when. Each answer is written as it lands: recordRecall, 回想's production
 * record, and on a miss recordPractice(id, false, { settle: false }) for each
 * word it marks, `missedAt` and nothing else. Not recordQuiz, which demotes
 * and ticks 今日's quiz row, and no 巩固 (`onReinforce`), whose consolidateWord
 * writes `lapses`.
 *
 * **Read once, on mount**, for the reason TangleDay1 gives: the record
 * re-renders the page, and a session rebuilt then would reshuffle its options
 * under the finger, or, with this tangle no longer due, swap in the next one.
 * The group questions are built once, from the mount's words and progress,
 * when their file arrives; until it has, the end screen offers none.
 *
 * Keys: Enter is the one way forward at every stage (开始答题, 下一题, 看结果,
 * then 下一团 — or 返回今日 once today's share of sessions is done, see the end
 * screen), 1..n pick an option, all printed on their controls. Every key
 * handled calls preventDefault, which is what stops the keypress that follows
 * a keydown from activating whatever the surface change has just put under
 * focus (CLAUDE.md, the 组句 bug). A held key's repeats are swallowed and do
 * nothing. Enter is taken only while nothing else has focus, so a focused
 * link or the back button keeps its own Enter. That is also why 再练 has no
 * key of its own: Enter on the end screen stays 下一团, and a focused 再练 takes
 * its own Enter as a button. **During the group questions this page listens
 * to no key at all**: RecallQuestionView has its own keydown and focuses its
 * own buttons, and one surface listens at a time.
 */
function TangleSession({ requested, onNext }: { requested: string | null; onNext(key: string): void }) {
  const { words, progress, recordTangle, recordRecall, recordPractice, rateRecall } = useApp()
  const [opened] = useState(() => openTangle(requested, words, progress))
  // The mount's library and progress, which the group questions are built
  // from; a ref's initial value is read on the first render only.
  const mounted = useRef({ words, progress })
  const [stage, setStage] = useState<Stage>('study')
  const [idx, setIdx] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [results, setResults] = useState<{ id: string; correct: boolean }[]>([])
  // Null until senseGroups.json has arrived; then fixed for the session.
  const [groupQs, setGroupQs] = useState<RecallQuestion[] | null>(null)
  const [groupIdx, setGroupIdx] = useState(0)
  // Played through once: the offer leaves the end screen, since a second run
  // would be the same questions in the same order, counted again.
  const [extrasDone, setExtrasDone] = useState(false)
  // Whether the question on screen is answered. A ref because a key and a
  // click in the same frame both run before the render that disables the
  // options; it is reset only by moving to the next question.
  const answeredRef = useRef(false)
  const recordedRef = useRef(false)
  // Whichever forward button is on screen; only one ever is.
  const forwardRef = useRef<HTMLButtonElement>(null)

  const byId = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])
  // What is still due once this session is recorded, for 下一团. Read live,
  // after the record, so the tangle just run has already left the list.
  const remaining = useMemo(
    () => (stage === 'end' ? dueTangles(progress.tangles, todayStr(new Date()), new Set(byId.keys())) : []),
    [stage, progress, byId],
  )
  // The same split 今日's row prints (untangleShare), so the two screens say
  // one number. Read at the end, like `remaining`: record() has bumped the
  // session mark by the time the stage gets there.
  const share = useMemo(
    () => untangleShare(
      remaining.length,
      untangleSessionsToday(storage.get<LocalMarks['untangleSessions']>('untangleSessions'), todayStr(new Date())),
    ),
    [remaining],
  )
  // Today's share is done and more are due: the cap is a default, not a wall,
  // so 下一团 stays, but as the option, and the way home takes Enter.
  const pastShare = share.today === 0 && share.beyond > 0
  const navigate = useNavigate()
  const goHome = useCallback(() => navigate('/'), [navigate])

  const questions = opened?.questions ?? []
  const q: TangleQuestion | undefined = questions[idx]
  const answer = q === undefined ? undefined : opened?.members.find((w) => w.id === q.answerId)?.headword

  const record = useCallback((all: { id: string; correct: boolean }[]) => {
    if (opened === null || recordedRef.current) return
    recordedRef.current = true
    recordTangle(
      opened.key, all.filter((r) => r.correct).map((r) => r.id), all.filter((r) => !r.correct).map((r) => r.id), opened.autoSettled,
    )
    storage.set('untangleSessions', bumpUntangleSessions(storage.get<LocalMarks['untangleSessions']>('untangleSessions'), todayStr(new Date())))
  }, [opened, recordTangle])

  const start = useCallback(() => {
    if (stage !== 'study') return
    // Every unsettled member settled by being shown: the side by side was
    // the session, and reading it was the answer.
    if (questions.length === 0) {
      record([])
      setStage('end')
    } else {
      setStage('ask')
    }
  }, [stage, questions.length, record])

  const choose = useCallback((opt: string) => {
    if (stage !== 'ask' || q === undefined || answeredRef.current) return
    answeredRef.current = true
    setChosen(opt)
    const all = [...results, { id: q.answerId, correct: opt === answer }]
    setResults(all)
    if (all.length === questions.length) record(all)
  }, [stage, q, answer, results, questions.length, record])

  const advance = useCallback(() => {
    if (stage !== 'ask' || !answeredRef.current) return
    if (idx + 1 < questions.length) {
      answeredRef.current = false
      setChosen(null)
      setIdx(idx + 1)
    } else {
      setStage('end')
    }
  }, [stage, idx, questions.length])

  // A sense-group answer, written when it lands. Nothing here reaches the
  // schedule or the tangle: see the note above TangleSession.
  const answerGroup = useCallback((q: RecallQuestion, correct: boolean, wrongIds: string[]) => {
    const id = q.orderIds[0]
    recordRecall([{ id, correct }])
    if (correct) return
    // A miss refutes 太简单, as it does in 回想 (QuizRecall's handleAnswered):
    // the rating is on this view's reveal, and would otherwise still read
    // 已标太简单 over the word just missed.
    if (progress.words[id]?.recallRating?.level === 'easy') rateRecall(id, 'none')
    for (const w of wrongIds) recordPractice(w, false, { settle: false })
  }, [progress, recordRecall, rateRecall, recordPractice])

  const extras = extrasDone ? 0 : groupQs?.length ?? 0

  const openExtras = useCallback(() => {
    if (stage === 'end' && extras > 0) setStage('groups')
  }, [stage, extras])

  // The last one hands back to the end screen it was opened from.
  const nextGroup = useCallback(() => {
    if (stage !== 'groups' || groupQs === null) return
    if (groupIdx + 1 < groupQs.length) {
      setGroupIdx(groupIdx + 1)
    } else {
      setExtrasDone(true)
      setStage('end')
    }
  }, [stage, groupQs, groupIdx])

  useEffect(() => {
    if (opened === null) return
    let alive = true
    const { words: w, progress: p } = mounted.current
    loadGroups().then(
      (groups) => { if (alive) setGroupQs(groupQuestions(groups, opened.members, w, p)) },
      // Extra practice: a file that fails to load costs the extras, never the session.
      () => { if (alive) setGroupQs([]) },
    )
    return () => { alive = false }
  }, [opened])

  const nextKey = remaining[0]
  const nextTangle = useMemo(() => (nextKey === undefined ? null : () => onNext(nextKey)), [nextKey, onNext])
  // What Enter does on the end screen: the next tangle while today's share
  // has one, home once it is done, nothing when none is due.
  const endForward = nextTangle === null ? null : pastShare ? goHome : nextTangle

  // The page is one scroll, and the side by side can run past a screen: the
  // questions start at the top, not wherever 开始答题 was.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [stage])

  // The answered question hands focus to 下一题, so a keyboard user is not left
  // on the option that just went disabled. Safe under the keypress hazard: an
  // answer by key has already had its keydown's default prevented, so no
  // keypress follows to land here.
  useEffect(() => {
    if (chosen !== null) forwardRef.current?.focus()
  }, [chosen])

  useEffect(() => {
    // Not during the group questions: RecallQuestionView owns the keys there,
    // with its own keydown for 1..n and its own focused buttons for Enter.
    // Left attached, this handler would still see the last cloze in `chosen`
    // and take an Enter on the body for a 下一题 that is no longer on screen;
    // each check that keeps that harmless today is one edit from gone.
    if (opened === null || stage === 'groups') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(document.activeElement)) return
      if (e.key === 'Enter') {
        const go = stage === 'study' ? start : stage === 'end' ? endForward : chosen !== null ? advance : null
        if (go === null) return
        const el = document.activeElement
        if (el !== null && el !== document.body && el !== forwardRef.current) return
        e.preventDefault()
        if (!e.repeat) go()
        return
      }
      if (stage !== 'ask' || q === undefined || chosen !== null) return
      const i = optionIndexFromKey(e, q.options.length)
      if (i < 0) return
      e.preventDefault()
      if (!e.repeat) choose(q.options[i])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [opened, stage, chosen, q, start, advance, choose, endForward])

  // The second click of a double click lands on whatever the first one put
  // there: 下一题's place can hold the next question's option. Keyboard
  // activation has detail 0 and is unaffected.
  const click = (act: () => void) => (e: ReactMouseEvent) => {
    if (e.detail > 1) return
    act()
  }

  if (opened === null) {
    return (
      <Page title={TITLE} back="/">
        <div className="review-done">
          <p className="review-done__label">没有要拆的词</p>
          <p className="muted">复习时把一个词想成了别的近义词，第二天它们会排到这里。</p>
          <Link to="/" className="btn btn--primary btn--lg">返回今日</Link>
        </div>
      </Page>
    )
  }

  if (stage === 'study') {
    const wordNotes = wordNotesFile as WordNotesFile
    return (
      <Page title={TITLE} back="/">
        {/* Says what the page does not do, before anything is answered: the
            same disclosure the drills print above their card. */}
        <p className="faint review-drill-note">先并排看一遍，再每个词答一道填空。只是练习，不影响复习排期。</p>

        <section className="section">
          <h2 className="section-head">
            并排看
            <span className="section-head__aside">
              <span className="num">{opened.members.length}</span> 个词
            </span>
          </h2>
          <ul className="ledger">
            {opened.members.map((w) => {
              const note = wordNote(wordNotes, w.id)
              return (
                <li key={w.id} className="ledger__row untangle-member">
                  <span className="ledger__main">
                    <span className="ledger__word" lang="en">{w.headword}</span>
                    <span className="ledger__secondary">{w.meanings[0]?.zh}</span>
                  </span>
                  {/* The word's own usage boundary, the 旁批 the review card
                      prints under its meanings. Most words have none and
                      show none (lib/wordNotes.ts). */}
                  {note !== undefined && (
                    <div className="margin-note">
                      <p className="margin-note__label">要点</p>
                      <p className="margin-note__text">{note}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {opened.notes.length > 0 && (
          <section className="section">
            <h2 className="section-head">差别在哪</h2>
            <ul className="ledger">
              {opened.notes.map((n) => {
                const pair = notePair(n.key, opened.members)
                return (
                  <li key={n.key} className="review-tangle__item">
                    {pair !== null && (
                      <p className="review-tangle__pair">
                        <span lang="en">{pair[0].headword}</span>
                        <span className="review-tangle__and">和</span>
                        <span lang="en">{pair[1].headword}</span>
                        {/* The pair the user confused, the reason the
                            tangle exists. A word, so it reads without
                            color; ink, because it is a label and not one of
                            the marks cinnabar is kept for. */}
                        {n.confused && <span className="untangle-note__mixed">混过</span>}
                      </p>
                    )}
                    <div className="margin-note">
                      <p className="margin-note__label">辨析</p>
                      <p className="margin-note__text">{n.text}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <div className="untangle-go">
          <p className="muted">
            {questions.length > 0 ? (
              <>
                <span className="num">{questions.length}</span> 道填空。答对的词算分清，答错的明天再问。
              </>
            ) : '这几个词找不到合适的例句出题，看过一遍就算拆完。'}
          </p>
          <Button ref={forwardRef} variant="primary" block onClick={click(start)}>
            {questions.length > 0 ? '开始答题' : '看完了'}
            <span className="key">Enter</span>
          </Button>
        </div>
      </Page>
    )
  }

  if (stage === 'ask' && q !== undefined) {
    const locked = chosen !== null
    const correct = chosen === answer
    const last = idx + 1 === questions.length
    return (
      <Page title={TITLE} back="/">
        {/* Keyed by the question, so a button focused on one question is
            unmounted rather than reused as a different control on the next. */}
        <div className="untangle-ask" key={idx}>
          <div className="review-progress">
            <ProgressMarks
              done={idx}
              total={questions.length}
              label="拆解进度"
              valueText={`第 ${idx + 1} 题，共 ${questions.length} 题`}
            />
            <p className="muted review-progress__count">
              第 <span className="num">{idx + 1}</span> 题，共 <span className="num">{questions.length}</span> 题
            </p>
          </div>

          <div className="review-tangle__q">
            <p className="muted untangle-ask__label">哪个词填进空里？</p>
            <p className="review-tangle__prompt" lang="en">
              <Blanked text={q.prompt} blankClass="review-tangle__blank" />
            </p>
            <div className="review-tangle__options" role="group" aria-label="选项">
              {q.options.map((opt, i) => {
                const isAnswer = opt === answer
                const variant = !locked ? 'secondary' : isAnswer ? 'correct' : opt === chosen ? 'incorrect' : 'secondary'
                return (
                  <Button key={opt} variant={variant} wrap block disabled={locked} onClick={click(() => choose(opt))}>
                    {/* The number printed on the option is the shortcut;
                        an unprinted one does not exist. */}
                    <span className="untangle-option">
                      <span className="key">{i + 1}</span>
                      <span className="review-tangle__opt-text" lang="en">{opt}</span>
                    </span>
                    {locked && isAnswer && <span className="review-tangle__tag">正确答案</span>}
                    {locked && !isAnswer && opt === chosen && <span className="review-tangle__tag">你的选择</span>}
                  </Button>
                )
              })}
            </div>
            {/* Right and wrong in words as well as color, as 今天混过的词 says
                them: 对 / 错, the tags above, and the right word by name. */}
            {locked && (
              <p className={correct ? 'review-tangle__verdict review-tangle__verdict--right' : 'review-tangle__verdict'} role="status">
                <span className="review-tangle__verdict-mark">{correct ? '对' : '错'}</span>
                {!correct && (
                  <>
                    答案是<span className="review-tangle__answer" lang="en">{answer}</span>
                  </>
                )}
              </p>
            )}
            {locked && (
              <Button ref={forwardRef} variant="primary" block onClick={click(advance)}>
                {last ? '看结果' : '下一题'}
                <span className="key">Enter</span>
              </Button>
            )}
          </div>
        </div>
      </Page>
    )
  }

  const gq = stage === 'groups' ? groupQs?.[groupIdx] : undefined
  if (gq !== undefined && groupQs !== null) {
    const lastGroup = groupIdx + 1 === groupQs.length
    return (
      <Page title={TITLE} back="/">
        <div className="review-progress">
          <ProgressMarks
            done={groupIdx}
            total={groupQs.length}
            label="加练进度"
            valueText={`加练第 ${groupIdx + 1} 题，共 ${groupQs.length} 题`}
          />
          <p className="muted review-progress__count">
            加练，第 <span className="num">{groupIdx + 1}</span> 题，共 <span className="num">{groupQs.length}</span> 题
          </p>
        </div>
        {/* The face changes here from the clozes to 回想's, so the page says
            again what these answers do not do. */}
        <p className="faint review-drill-note">只是加练，不算分清，也不影响复习排期。</p>
        {/* The second click of a double click on 再练 or 下一题 lands on
            whatever the first put under the pointer, which here is the next
            question's 我想好了 / 想不起来, and 想不起来 on a 排序 settles a
            miss. It is dropped in the capture phase, before the view sees
            it: the rule click() applies to this page's own buttons, and
            keyboard activation (detail 0) is unaffected. Its mousedown is
            stopped from moving focus too, or 想不起来 would hold the focus
            the view gave 我想好了, and the next Enter would give up. */}
        <div
          onMouseDownCapture={(e) => { if (e.detail > 1) e.preventDefault() }}
          onClickCapture={(e) => { if (e.detail > 1) e.stopPropagation() }}
        >
          {/* Keyed by the question, so each one mounts with its commit gate
              closed and its own button focused. No onReinforce: 巩固 writes
              `lapses`, which a tangle never touches. */}
          <RecallQuestionView
            key={groupIdx}
            question={gq}
            onAnswered={(correct, ids) => answerGroup(gq, correct, ids)}
            onNext={nextGroup}
            nextLabel={lastGroup ? '回到结果' : '下一题'}
            reinforced={false}
          />
        </div>
      </Page>
    )
  }

  const right = results.filter((r) => r.correct).length
  const unsettled = results.filter((r) => !r.correct).flatMap((r) => {
    const w = byId.get(r.id)
    return w === undefined ? [] : [w]
  })
  // Done is what this session leaves: every member it asked about answered
  // right (a member it could not ask about was settled by being shown), the
  // same test applyTangleResults writes doneOn by.
  const done = results.every((r) => r.correct)
  return (
    <Page title={TITLE} back="/">
      <div className="review-done">
        <p className="review-done__label">{done ? '这一团拆完了' : '明天再来'}</p>
        <p className="muted">
          {questions.length === 0
            ? '这几个词看过一遍，这一团就到这里。'
            : done
              ? '这一轮全答对了。每个词都答对过一次，这一团就到这里。'
              : <>
                  答对 <span className="num">{right} / {questions.length}</span>。没答对的明天只问它们，答对的不用再答。
                </>}
        </p>
        {/* Below today's share, 下一团 is the way on and the count is the one
            今日 prints for the row (untangleShare). Past it, the share is done:
            返回今日 takes the primary slot and Enter, and 下一团 stays as the
            option, with how many lie beyond the share. */}
        {nextTangle !== null && !pastShare && (
          <>
            <Button ref={forwardRef} variant="primary" size="lg" onClick={click(nextTangle)}>
              下一团<span className="key">Enter</span>
            </Button>
            <p className="faint">
              今天还有 <span className="num">{share.today}</span> 团
            </p>
          </>
        )}
        <Link to="/" className={nextTangle !== null && !pastShare ? 'btn btn--secondary btn--lg' : 'btn btn--primary btn--lg'}>
          返回今日{pastShare && <span className="key">Enter</span>}
        </Link>
        {nextTangle !== null && pastShare && (
          <>
            <p className="faint">
              今天的份做完了，另外还有 <span className="num">{share.beyond}</span> 团
            </p>
            <Button variant="secondary" size="lg" onClick={click(nextTangle)}>
              下一团
            </Button>
          </>
        )}
        {/* The sense groups inside this tangle, offered after the verdict and
            never in front of it (see the note above TangleSession). Last and
            small, like 回想's 我想的不是这几个: an option, not the way on. No
            key, so Enter here stays 下一团. */}
        {extras > 0 && (
          <Button variant="secondary" size="sm" onClick={click(openExtras)}>
            再练 <span className="num">{extras}</span> 道回想题
          </Button>
        )}
      </div>
      {unsettled.length > 0 && <MissedWords title="还没分清" rows={unsettled.map((w) => ({ word: w }))} />}
    </Page>
  )
}
