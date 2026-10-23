import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '../components/Button'
import contrastNotesFile from '../data/contrastNotes.json'
import { contrastNoteKey } from '../lib/contrastNotes'
import type { ContrastNotesFile } from '../lib/contrastNotes'
import type { ForgetInput, ForgetOption } from '../lib/forget'
import { isEditableTarget, optionIndexFromKey } from '../lib/keys'
import { useApp } from '../state/store'
import type { Word } from '../types'

/** What the question decides. The two `prev` fields are the review page's to add: only it saw the entry before the grade. */
type ForgetAnswer = Omit<ForgetInput, 'prevInterval' | 'prevReviewedAt'>

/** One row of 想成了别的. A partner's meaning carries the partner, and choosing it records the answer first and then shows the pair, so leaving at the pair keeps the record. */
interface Choice {
  label: string
  answer: ForgetAnswer
  partnerId?: string
  /** 它自己的另一个意思 and 意思想错了，但不在这里: answers about the list, not meanings on it, so they are set lighter. */
  meta: boolean
}

type Stage = { at: 'how' } | { at: 'which' } | { at: 'pair'; partnerId: string }

/**
 * 怎么忘的？ — asked once per lapse, after the 重来 has been graded (spec §1).
 *
 * Three hazards, each handled here and not left to the caller:
 *
 * - **Nothing is autofocused.** A focused button is activated by the
 *   keypress that follows a keydown, so focusing one under a key the user is
 *   still pressing answers the question for them (CLAUDE.md, the 组句 bug).
 *   Keys come in through one window listener instead, and every key it
 *   handles calls `preventDefault()`.
 * - **`e.repeat` is ignored.** The 重来 that opened this may be a held 1, and
 *   its auto-repeat would otherwise land on 一片空白 the moment it mounts.
 * - **The second click of a double click is ignored** (`detail > 1`). The
 *   question takes the grade row's place, and 一片空白 covers the column 重来
 *   was in, so the old guard against grading twice became a wrong answer.
 *   Keyboard activation has `detail` 0 and is unaffected.
 *
 * Each stage's container carries its own `key`, so a button focused in one
 * stage is unmounted rather than reused as a different control in the next.
 *
 * **Two callbacks, because answering and moving on are two moments.**
 * `onAnswer` writes the record and fires at the choice, on every path. A
 * named partner then shows the pair and its note, and `onContinue` waits for
 * 继续; every other answer continues at once. That is the spec's order,
 * record then reveal: stage 3 is where the user has already answered and is
 * most likely to stop, and a record written at 继续 was lost by leaving there.
 */
export function ForgetAsk({ word, options, polysemous, onAnswer, onContinue }: {
  word: Word
  options: ForgetOption[]
  polysemous: boolean
  /** Records the answer. Fired at most once per lapse, at the choice, before any reveal; never for 其实没忘. */
  onAnswer(rec: ForgetAnswer): void
  /** Moves the session on. Fired once: with onAnswer, on 继续 after a partner, or alone for 其实没忘. */
  onContinue(): void
}) {
  const { words } = useApp()
  const [stage, setStage] = useState<Stage>({ at: 'how' })
  // Each fires once per lapse. A handler can run against a stage that has
  // already moved on (a second key in the same task, a key and a click
  // together), and the ref, unlike the stage, is never a render behind: a
  // fast repeat on a partner cannot write a second record, and a stray choice
  // after one cannot skip the pair it opened.
  const answeredRef = useRef(false)
  const continuedRef = useRef(false)
  const answer = useCallback((rec: ForgetAnswer): boolean => {
    if (answeredRef.current) return false
    answeredRef.current = true
    onAnswer(rec)
    return true
  }, [onAnswer])
  const proceed = useCallback(() => {
    if (!answeredRef.current || continuedRef.current) return
    continuedRef.current = true
    onContinue()
  }, [onContinue])
  // Every answer but a partner: nothing to reveal, so on at once.
  const finish = useCallback((rec: ForgetAnswer) => {
    if (answer(rec)) proceed()
  }, [answer, proceed])
  // 其实没忘: the 重来 was pressed to see the word sooner — 不熟 still grows
  // the interval (×1.2, then the interval modifier: ×1.8 at the user's 1.5),
  // and only 重来 brings a word back tomorrow. Two answers that both said
  // "forgot" made the user pick one anyway (2026-10-23), and that record would
  // count in the "what interval is a word lost at" analysis as a real
  // forgetting. So it writes nothing, and the grade stands: lapses +1 and the
  // ease dent are the scheduler's, and both say "watch this word", which is
  // why it was pressed. Closes the answer like any other, so no later key in
  // the same lapse can still record one.
  const notForgotten = useCallback(() => {
    if (answeredRef.current) return
    answeredRef.current = true
    proceed()
  }, [proceed])

  const choices = useMemo((): Choice[] => [
    ...options.map((o): Choice => ({
      label: o.text, answer: { kind: 'confused', with: o.partnerId }, partnerId: o.partnerId, meta: false,
    })),
    ...(polysemous ? [{ label: '它自己的另一个意思', answer: { kind: 'confused', with: 'self' }, meta: true } satisfies Choice] : []),
    { label: '意思想错了，但不在这里', answer: { kind: 'confused' }, meta: true },
  ], [options, polysemous])

  // A list holding only 意思想错了，但不在这里 asks nothing: 想成了别的 already said it.
  const pickConfused = useCallback(() => {
    if (answeredRef.current) return
    if (choices.length === 1) finish({ kind: 'confused' })
    else setStage({ at: 'which' })
  }, [choices.length, finish])

  // A partner is recorded here, before the pair is shown, not at 继续.
  const pickChoice = useCallback((c: Choice) => {
    const partnerId = c.partnerId
    if (partnerId === undefined) finish(c.answer)
    else if (answer(c.answer)) setStage({ at: 'pair', partnerId })
  }, [answer, finish])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if (stage.at === 'how') {
        const i = optionIndexFromKey(e, 4)
        if (i < 0) return
        e.preventDefault()
        if (i === 0) finish({ kind: 'blank' })
        else if (i === 1) pickConfused()
        else if (i === 2) finish({ kind: 'partial' })
        else notForgotten()
        return
      }
      if (stage.at === 'which') {
        const i = optionIndexFromKey(e, choices.length)
        if (i < 0) return
        e.preventDefault()
        pickChoice(choices[i])
        return
      }
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(document.activeElement)) return
      e.preventDefault()
      proceed()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stage.at, choices, finish, pickConfused, notForgotten, pickChoice, proceed])

  const click = (act: () => void) => (e: ReactMouseEvent) => {
    if (e.detail > 1) return
    act()
  }

  if (stage.at === 'how') {
    return (
      <div className="review-forget" key="how" role="group" aria-labelledby="review-forget-q">
        <p className="review-forget__q" id="review-forget-q">怎么忘的？</p>
        {/* Most forgotten first: the top row did not have the word, the bottom
            row had it, in part or whole. */}
        <div className="ruled-row review-forget__answers">
          <Button onClick={click(() => finish({ kind: 'blank' }))}>
            <span className="ruled-row__label">
              一片空白<span className="key">1</span>
            </span>
          </Button>
          <Button onClick={click(pickConfused)}>
            <span className="ruled-row__label">
              想成了别的<span className="key">2</span>
            </span>
          </Button>
          <Button onClick={click(() => finish({ kind: 'partial' }))}>
            <span className="ruled-row__label">
              没想全<span className="key">3</span>
            </span>
          </Button>
          <Button onClick={click(notForgotten)}>
            <span className="ruled-row__label">
              其实没忘<span className="key">4</span>
            </span>
          </Button>
        </div>
      </div>
    )
  }

  if (stage.at === 'which') {
    return (
      <div className="review-forget" key="which" role="group" aria-labelledby="review-forget-q">
        <p className="review-forget__q" id="review-forget-q">想成了哪个意思？</p>
        <ul className="ledger">
          {choices.map((c, i) => (
            <li key={c.partnerId ?? c.label}>
              <button
                type="button"
                className={c.meta ? 'ledger__row review-forget__choice review-forget__choice--meta' : 'ledger__row review-forget__choice'}
                onClick={click(() => pickChoice(c))}
              >
                <span className="key">{i + 1}</span>
                <span className="ledger__main">
                  <span className="ledger__primary">{c.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // The pair, then what separates it, before moving on: the moment the
  // confusion is named is the one moment the user is asking that question.
  // A partner deleted mid-question (another device) leaves its row out; the
  // record still names it, and recordForget opens no tangle for a word that
  // is gone.
  const partner = words.find((w) => w.id === stage.partnerId)
  const note = (contrastNotesFile as ContrastNotesFile).notes[contrastNoteKey(word.id, stage.partnerId)]
  return (
    <div className="review-forget" key="pair" role="group" aria-label="两个词的差别">
      <p className="review-forget__pair">
        <span lang="en">{word.headword}</span>
        {partner !== undefined && (
          <>
            <span className="review-forget__and">和</span>
            <span lang="en">{partner.headword}</span>
          </>
        )}
      </p>
      {/* Written about the pair rather than copied from either entry, so it
          is the 旁批 — the same margin note 辨析's ContrastCard prints. A pair
          without a note shows none (see lib/contrastNotes.ts). */}
      {note !== undefined && (
        <div className="margin-note">
          <p className="margin-note__label">辨析</p>
          <p className="margin-note__text">{note}</p>
        </div>
      )}
      <Button variant="primary" block onClick={click(proceed)}>
        继续<span className="key">Enter</span>
      </Button>
    </div>
  )
}
