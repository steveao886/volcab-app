import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { TextInput } from '../components/TextInput'
import { buildConceptIndex, divergeKey, DIVERGE_RECENT_LIMIT, gradeInput, generateDivergeSession, HINT_TIERS, hintOpen, MIN_ANSWERS } from '../lib/diverge'
import type { Concept, ConceptIndex, DivergeAxis, DivergeQuestion, Verdict } from '../lib/diverge'
import { pushRecent } from '../lib/passage'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import type { Word } from '../types'
import { ResultScore } from './QuizResult'

/**
 * 发散 — one Chinese concept, produce every English word around it.
 *
 * The answer is a **set**, which is what rules options out: four choices for a
 * five-word answer is the answer sheet. So it is typed, and the typing is
 * forgiving in three specific ways and unforgiving in exactly one — see
 * gradeInput, whose rule order is the contract this file renders.
 *
 * Thin by the repo's rule: everything decidable lives in lib/diverge.ts and
 * this file paints what it decides. See
 * docs/superpowers/specs/2026-09-18-diverge-mode-design.md.
 */

const QUESTION_COUNT = 8

/**
 * Printed on every question: without it you cannot tell which direction is
 * being asked.
 *
 * **否定前缀 is a noun, and 加否定 was not.** "加否定" names an operation to
 * perform on the prompt, so beside a 〔反面〕 question in the same round it
 * reads as "now give me the opposite" — which is what the user read it as.
 * The axis asks for the opposite of nothing: its answers *mean* the prompt
 * (怎么劝都不松口 → implacable / intractable / intransigent / uncompromising)
 * and merely happen to be built out of a negative prefix. A noun describes
 * the answers' shape and cannot be read as an instruction to invert.
 */
const AXIS_LABEL: Record<DivergeAxis, string> = {
  synonym: '近义',
  opposite: '反面',
  pos: '换词性',
  negation: '否定前缀',
}

const POS_LABEL: Record<string, string> = {
  'n.': '名词',
  'adj.': '形容词',
  'v.': '动词',
  'adv.': '副词',
  'prep.': '介词',
}

/**
 * The instruction, rendered as its own line rather than glued onto the prompt.
 *
 * 固执、不肯改变主意 + 的反面 reads as one run-on phrase; on its own line under
 * the prompt it reads as an instruction, which is what it is. The prompts are
 * authored as free Chinese and not all of them can take a suffix.
 *
 * **The negation line opens with 同样的意思 because that was the part that was
 * missing.** It used to read 说出带否定前缀的词, which says what shape to type
 * and never says what to mean, so nothing on screen ruled out the opposite —
 * the spec's own worked example was 固执（要带否定前缀的）, and it is the
 * 要…的 qualifier, not the prefix list, that carries the sense.
 */
function instructionFor(q: DivergeQuestion): string {
  if (q.axis === 'opposite') return '说出意思相反的词，有几个写几个'
  if (q.axis === 'negation') return '同样的意思，但要用否定前缀构成的词（un- / in- / im- / ir- / il- / dis- / non-）'
  if (q.axis === 'pos') return `说出这个意思的${POS_LABEL[q.pos ?? ''] ?? q.pos ?? ''}形式`
  return '说出意思相近的词，有几个写几个'
}

/** How one produced answer landed. `hinted` is kept apart from `typo`: they are different findings. */
interface Landed { form: string; typo: boolean; hinted: boolean }

const maskTo = (form: string, open: number): string =>
  form.slice(0, open) + '•'.repeat(Math.max(form.length - open, 0))

/**
 * What to say about one submission.
 *
 * `otherWord` and `outside` are phrased as information, never as a mistake. A
 * correct English synonym this library happens not to hold is the learner
 * being right; calling it wrong makes the app look stupid.
 */
function noteText(v: Verdict, index: ConceptIndex): string {
  if (v.kind === 'hit') return v.typo ? `对了，不过正确拼写是 ${v.form}` : '对了'
  if (v.kind === 'already') return `${v.form} 已经答过了`
  if (v.kind === 'prefix') return `前缀错了 —— 是 ${v.form}`
  if (v.kind === 'otherWord') return `${index.byId.get(v.wordId)?.headword ?? v.wordId} 是词库里的另一个词，本题不算`
  return '这个词不在本题的答案里'
}

interface QuestionViewProps {
  question: DivergeQuestion
  index: ConceptIndex
  /** How many answers this set gained since it was last played. 0 hides the badge. */
  grown: number
  sound: boolean
  /** Fires once, when the set is filled or 我答完了 is pressed. */
  onSettle: (produced: Landed[]) => void
  /** Fires on 下一题, carrying the ids the user marked 这个我真不会. */
  onNext: (conceded: string[]) => void
  nextLabel: string
}

function DivergeQuestionView({ question, index, grown, sound, onSettle, onNext, nextLabel }: QuestionViewProps) {
  const [value, setValue] = useState('')
  const [landed, setLanded] = useState<Landed[]>([])
  const [hintTier, setHintTier] = useState(0)
  const [note, setNote] = useState<Verdict | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [conceded, setConceded] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const found = useMemo(() => new Set(landed.map(l => l.form)), [landed])

  useEffect(() => { inputRef.current?.focus() }, [])

  const settle = useCallback((final: Landed[]) => {
    setRevealed(true)
    onSettle(final)
  }, [onSettle])

  const submit = () => {
    const v = gradeInput(value, question, index, found)
    setNote(v)
    setValue('')
    if (v.kind !== 'hit') return
    const next = [...landed, { form: v.form, typo: v.typo, hinted: hintTier > 0 }]
    setLanded(next)
    playQuizResult(true, sound)
    if (next.length === question.answers.length) settle(next)
  }

  const toggleConcede = (wordId: string) =>
    setConceded(c => c.includes(wordId) ? c.filter(x => x !== wordId) : [...c, wordId])

  return (
    <div className="diverge-q">
      <p className="diverge-q__axis">〔{AXIS_LABEL[question.axis]}〕</p>
      <p className="diverge-q__prompt">{question.zh}</p>
      <p className="diverge-q__ask muted">{instructionFor(question)}</p>

      <p className="diverge-q__count">
        已答出 <span className="num">{landed.length}</span> / <span className="num">{question.answers.length}</span>
        {/* A grown set is announced rather than silently re-denominated: the
            membership is derived from what you have learned, so it moves. */}
        {grown > 0 ? <span className="diverge-q__grown">（比上次多了 <span className="num">{grown}</span> 个词）</span> : null}
      </p>

      <ul className="diverge-q__slots">
        {question.answers.map(a => {
          const got = landed.find(l => l.form === a.form)
          return (
            <li
              key={a.form}
              className={`diverge-slot${got ? ' diverge-slot--got' : ''}${revealed && !got ? ' diverge-slot--missed' : ''}`}
            >
              {/* A found answer gets the teacher's 勾 in the margin; the
                  words beside it still say how it was found. */}
              {got ? <span className="mark-tick diverge-slot__mark" role="img" aria-label="答出" /> : null}
              <span className="diverge-slot__word" lang="en">
                {got || revealed ? a.form : maskTo(a.form, hintOpen(a.form, hintTier, question.axis)) || '•'.repeat(Math.min(a.form.length, 12))}
              </span>
              {/* Every state carries a word, never colour alone — the rule the
                  quiz options already follow, for colourblind users and for
                  screenshots. */}
              {got?.typo ? <span className="diverge-slot__tag">拼写差一点</span> : null}
              {got?.hinted ? <span className="diverge-slot__tag">提示后答出</span> : null}
              {revealed && !got ? (
                <>
                  <span className="diverge-slot__tag">没答出</span>
                  <Button
                    type="button"
                    size="sm"
                    className="diverge-slot__concede"
                    variant={conceded.includes(a.wordId) ? 'primary' : 'secondary'}
                    aria-pressed={conceded.includes(a.wordId)}
                    onClick={() => toggleConcede(a.wordId)}
                  >
                    {conceded.includes(a.wordId) ? '已标记，点此取消' : '这个我真不会'}
                  </Button>
                </>
              ) : null}
            </li>
          )
        })}
      </ul>

      {!revealed ? (
        <form className="diverge-q__form" onSubmit={e => { e.preventDefault(); submit() }}>
          <Field label="写一个词" htmlFor="diverge-input">
            <TextInput
              ref={inputRef}
              id="diverge-input"
              lang="en"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={value}
              onChange={e => setValue(e.target.value)}
            />
          </Field>
          {note ? <p className={`diverge-q__note diverge-q__note--${note.kind}`}>{noteText(note, index)}</p> : null}
          <Button type="submit" variant="primary" block disabled={value.trim() === ''}>提交</Button>
          <div className="diverge-q__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setHintTier(t => Math.min(t + 1, HINT_TIERS.length))}
              disabled={hintTier >= HINT_TIERS.length}
            >
              提示
            </Button>
            <Button type="button" variant="secondary" onClick={() => settle(landed)}>我答完了</Button>
          </div>
        </form>
      ) : (
        <div className="diverge-q__done">
          <p>
            这题答出 <span className="num">{landed.length}</span> / <span className="num">{question.answers.length}</span>
            {landed.some(l => l.hinted) ? `，其中 ${landed.filter(l => l.hinted).length} 个用了提示` : null}
          </p>
          {conceded.length > 0 ? <p className="muted">{conceded.length} 个词会进明天的补漏</p> : null}
          <Button type="button" variant="primary" block onClick={() => onNext(conceded)}>{nextLabel}</Button>
        </div>
      )}
    </div>
  )
}

export function QuizDiverge({ concepts, words, onRestart }: { concepts: Concept[]; words: Word[]; onRestart: () => void }) {
  const { progress, recordRecall, recordPractice, recordDiverge } = useApp()
  const [i, setI] = useState(0)
  const [done, setDone] = useState(false)
  const [rounds, setRounds] = useState<{ key: string; produced: number; size: number }[]>([])
  const settled = useRef(false)

  const index = useMemo(() => buildConceptIndex(words), [words])
  // Lazy initialiser rather than a memo with an empty dependency list: the
  // round is drawn exactly once, and restarting swaps this whole component out
  // through `key`, so there is no session state to reset by hand.
  // The recency list is read once, with the round: questions answered during
  // this round join it as they settle, and re-reading it here would let the
  // round reorder itself underneath the person playing it.
  const [questions] = useState(() => generateDivergeSession(
    concepts, words, progress, QUESTION_COUNT, Math.random,
    storage.get<string[]>('recentDiverge') ?? [],
  ))

  const onSettle = useCallback((q: DivergeQuestion, landed: Landed[]) => {
    // Seen means settled, not drawn — the same contract 回想 keeps. Quitting
    // a round halfway must not mark the questions you never reached, and it
    // must still mark the ones you did: recordDiverge below only fires on a
    // finished round, which is exactly the gap this list closes. The write
    // result is ignored on purpose; losing it costs a repeat.
    storage.set('recentDiverge', pushRecent(
      storage.get<string[]>('recentDiverge') ?? [], divergeKey(q), DIVERGE_RECENT_LIMIT,
    ))
    setRounds(r => [...r, {
      key: divergeKey(q),
      produced: landed.filter(l => !l.hinted).length,
      size: q.answers.length,
    }])
    // **Reward only.** A produced word records a production success; an
    // unproduced one writes nothing at all. The reasons for not producing a
    // word are not distinguishable by machine — genuinely absent, momentarily
    // absent, recognised instantly on reveal, or simply not a word you wanted
    // — and a 7-answer question banking 4 misses would flood the lapse queue
    // within two rounds.
    //
    // `derived` answers are skipped: a related form has no progress entry of
    // its own, and crediting the base word for producing its noun would record
    // something that did not happen.
    const got = new Set(landed.map(l => l.form))
    recordRecall(q.answers.filter(a => got.has(a.form) && !a.derived).map(a => ({ id: a.wordId, correct: true })))
  }, [recordRecall])

  const onNext = useCallback((conceded: string[]) => {
    // The knife is the user's. recordPractice is the door because it stamps
    // missedAt and touches nothing the scheduler owns — not ease, not
    // intervalDays, not due. Written here rather than on each tap so that
    // un-toggling is free: a cleared mark simply never reaches progress.
    for (const id of conceded) recordPractice(id, false)
    setI(prev => {
      if (prev + 1 >= questions.length) { setDone(true); return prev }
      return prev + 1
    })
  }, [recordPractice, questions.length])

  useEffect(() => {
    if (!done || settled.current) return
    settled.current = true
    recordDiverge(rounds)
  }, [done, rounds, recordDiverge])

  if (questions.length === 0) {
    return (
      <div className="quiz-empty">
        <p>还没有能出的题。发散要一个概念下至少有 {MIN_ANSWERS} 个你已经学过的词 —— 再学一阵子，题会自己多起来。</p>
      </div>
    )
  }

  if (done) {
    const produced = rounds.reduce((n, r) => n + r.produced, 0)
    const total = rounds.reduce((n, r) => n + r.size, 0)
    return (
      <>
        <ResultScore
          value={<>{produced}<span className="quiz-result__of"> / {total}</span></>}
          label="不靠提示答出"
        >
          这个分母会变 —— 题目里的词是从你学过的词里现算的，学得越多，同一道题越长。
        </ResultScore>
        <Button type="button" variant="primary" size="lg" block onClick={onRestart}>再来一轮</Button>
      </>
    )
  }

  const q = questions[i]
  const last = progress.diverge?.[divergeKey(q)]
  // On the page, not in a card, like every question since round 1.
  return (
    <div className="diverge">
      {/* Not .quiz-progress: that class is a grid container elsewhere, and
          reusing it here stacked 第 / 1 / 8 / 题 onto four lines. */}
      <p className="diverge-q__progress muted">
        第 <span className="num">{i + 1}</span> / <span className="num">{questions.length}</span> 题
      </p>
      <DivergeQuestionView
        key={divergeKey(q)}
        question={q}
        index={index}
        sound={isSoundEnabled(progress.settings)}
        grown={last ? Math.max(q.answers.length - last.size, 0) : 0}
        onSettle={landed => onSettle(q, landed)}
        onNext={onNext}
        nextLabel={i + 1 >= questions.length ? '看结果' : '下一题'}
      />
    </div>
  )
}
