import { Fragment, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import contrastNotesFile from '../data/contrastNotes.json'
import { contrastNoteKey } from '../lib/contrastNotes'
import type { ContrastNotesFile } from '../lib/contrastNotes'
import { pairContrastQuestion } from '../lib/quiz'
import type { QuizQuestion } from '../lib/quiz'
import { useApp } from '../state/store'
import type { Word } from '../types'

/** What clozeExample puts where the headword was (lib/quiz.ts keeps the constant private). */
const BLANK = '___'

interface DayOneItem {
  lapsed: Word
  partner: Word
  note: string | undefined
  /** Null when no example of the lapsed word blanks cleanly without the partner left in it. */
  question: QuizQuestion | null
}

/**
 * Both words of each pair still in the library, with the pair's note and its
 * one question. The lapsed word is always the answer: it is the word the user
 * forgot, and a miss here stamps `missedAt` on the answer's entry, which must
 * not land on a partner they never lapsed on.
 */
function buildItems(pairs: { lapsed: string; partner: string }[], words: Word[]): DayOneItem[] {
  const byId = new Map(words.map((w) => [w.id, w]))
  const notes = (contrastNotesFile as ContrastNotesFile).notes
  const items: DayOneItem[] = []
  for (const { lapsed, partner } of pairs) {
    const a = byId.get(lapsed)
    const b = byId.get(partner)
    if (a === undefined || b === undefined) continue
    items.push({ lapsed: a, partner: b, note: notes[contrastNoteKey(a.id, b.id)], question: pairContrastQuestion(a, b, Math.random) })
  }
  return items
}

/** The cloze prompt with each blank given its own span, so the gap reads as a gap and not as three underscores. */
function renderBlanked(text: string): ReactNode {
  const parts = text.split(BLANK)
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <span className="review-tangle__blank">{BLANK}</span> : null}
    </Fragment>
  ))
}

/**
 * 今天混过的词 — day 1 of a tangle (spec §3), on 复习完成 in the scheduled
 * review: each pair confused today, what separates it, and one two-option
 * question about it. A minute, and it asks nothing the schedule reads.
 *
 * **The questions are built once, on mount.** pairContrastQuestion shuffles,
 * and answering commits progress, which re-renders Review and with it this
 * component: a question rebuilt on render would reshuffle its options under
 * the finger that just chose one. The same reason the quiz pages fill their
 * question list from a lazy initial value. The pair list is read at the same
 * moment, so a pair that lands later (a sync from the other device) shows on
 * the next visit rather than moving this screen.
 *
 * **Nothing is stored about it.** Opening the done screen again shows today's
 * pairs again, which costs a minute at most; a done marker would be one more
 * synced field to keep in agreement across two devices, for no better a
 * screen. That settles the spec's "how day 1's done state is stored".
 *
 * No keyboard shortcuts: with several pairs on the page, a 1 or a 2 has no one
 * question to answer. Each option is a button and tabs like one.
 */
export function TangleDay1({ pairs }: { pairs: { lapsed: string; partner: string }[] }) {
  const { words } = useApp()
  const [items] = useState(() => buildItems(pairs, words))
  if (items.length === 0) return null

  return (
    <section className="section review-tangle">
      <h2 className="section-head">今天混过的词</h2>
      <ul className="ledger">
        {items.map((item) => (
          <li key={`${item.lapsed.id}|${item.partner.id}`} className="review-tangle__item">
            <p className="review-tangle__pair">
              <span lang="en">{item.lapsed.headword}</span>
              <span className="review-tangle__and">和</span>
              <span lang="en">{item.partner.headword}</span>
            </p>
            {/* The one sentence written about the pair rather than copied
                from either entry, so it is the 旁批, as in 辨析's reveal and
                in ForgetAsk's pair stage. A pair without a note shows none
                (see lib/contrastNotes.ts). */}
            {item.note !== undefined && (
              <div className="margin-note">
                <p className="margin-note__label">辨析</p>
                <p className="margin-note__text">{item.note}</p>
              </div>
            )}
            {item.question !== null && <PairQuestion question={item.question} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One pair's question: the sentence with its blank, the two words, and after a
 * choice the verdict.
 *
 * Practice in CLAUDE.md's sense, so it reaches the store the way the drills do:
 * `recordPractice(answerId, correct, { settle: false })`, where a miss stamps
 * `missedAt` and a right answer writes nothing. `settle: false` because a right
 * answer minutes after the lapse is short-term memory, which is exactly what
 * the stubborn-word pool refuses to credit; only a scheduled review clears it.
 *
 * **Right and wrong are said in words as well as colour:** 对 / 错, the
 * 正确答案 / 你的选择 tags on the options, and the right headword by name.
 */
function PairQuestion({ question }: { question: QuizQuestion }) {
  const { recordPractice } = useApp()
  const [chosen, setChosen] = useState<string | null>(null)
  // A second tap in the same frame lands before the render that disables the
  // buttons, and would write a second answer.
  const answeredRef = useRef(false)
  const locked = chosen !== null
  const correct = chosen === question.answer

  function choose(opt: string) {
    if (answeredRef.current) return
    answeredRef.current = true
    setChosen(opt)
    recordPractice(question.wordId, opt === question.answer, { settle: false })
  }

  return (
    <div className="review-tangle__q">
      <p className="review-tangle__prompt" lang="en">{renderBlanked(question.prompt)}</p>
      <div className="review-tangle__options" role="group" aria-label="选项">
        {question.options.map((opt) => {
          const isAnswer = opt === question.answer
          const variant = !locked ? 'secondary' : isAnswer ? 'correct' : opt === chosen ? 'incorrect' : 'secondary'
          return (
            <Button key={opt} variant={variant} wrap block disabled={locked} onClick={() => choose(opt)}>
              <span className="review-tangle__opt-text" lang="en">{opt}</span>
              {locked && isAnswer && <span className="review-tangle__tag">正确答案</span>}
              {locked && !isAnswer && opt === chosen && <span className="review-tangle__tag">你的选择</span>}
            </Button>
          )
        })}
      </div>
      {locked && (
        <p className={correct ? 'review-tangle__verdict review-tangle__verdict--right' : 'review-tangle__verdict'} role="status">
          <span className="review-tangle__verdict-mark">{correct ? '对' : '错'}</span>
          {!correct && (
            <>
              答案是<span className="review-tangle__answer" lang="en">{question.answer}</span>
            </>
          )}
        </p>
      )}
    </div>
  )
}
