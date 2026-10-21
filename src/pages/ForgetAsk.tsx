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

/** One row of 想成了别的. A partner's meaning carries the partner, and choosing it shows the pair before anything is recorded. */
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
 */
export function ForgetAsk({ word, options, polysemous, onDone }: {
  word: Word
  options: ForgetOption[]
  polysemous: boolean
  onDone(rec: ForgetAnswer): void
}) {
  const { words } = useApp()
  const [stage, setStage] = useState<Stage>({ at: 'how' })
  // One answer per lapse: a double press of 继续, or a key and a click in the
  // same moment, would otherwise write the record twice.
  const doneRef = useRef(false)
  const finish = useCallback((rec: ForgetAnswer) => {
    if (doneRef.current) return
    doneRef.current = true
    onDone(rec)
  }, [onDone])

  const choices = useMemo((): Choice[] => [
    ...options.map((o): Choice => ({
      label: o.text, answer: { kind: 'confused', with: o.partnerId }, partnerId: o.partnerId, meta: false,
    })),
    ...(polysemous ? [{ label: '它自己的另一个意思', answer: { kind: 'confused', with: 'self' }, meta: true } satisfies Choice] : []),
    { label: '意思想错了，但不在这里', answer: { kind: 'confused' }, meta: true },
  ], [options, polysemous])

  // A list holding only 意思想错了，但不在这里 asks nothing: 想成了别的 already said it.
  const pickConfused = useCallback(() => {
    if (choices.length === 1) finish({ kind: 'confused' })
    else setStage({ at: 'which' })
  }, [choices.length, finish])

  const pickChoice = useCallback((c: Choice) => {
    if (c.partnerId !== undefined) setStage({ at: 'pair', partnerId: c.partnerId })
    else finish(c.answer)
  }, [finish])

  const partnerId = stage.at === 'pair' ? stage.partnerId : undefined
  const proceed = useCallback(() => {
    if (partnerId !== undefined) finish({ kind: 'confused', with: partnerId })
  }, [partnerId, finish])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if (stage.at === 'how') {
        const i = optionIndexFromKey(e, 2)
        if (i < 0) return
        e.preventDefault()
        if (i === 0) finish({ kind: 'blank' })
        else pickConfused()
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
  }, [stage.at, choices, finish, pickConfused, pickChoice, proceed])

  const click = (act: () => void) => (e: ReactMouseEvent) => {
    if (e.detail > 1) return
    act()
  }

  if (stage.at === 'how') {
    return (
      <div className="review-forget" key="how" role="group" aria-labelledby="review-forget-q">
        <p className="review-forget__q" id="review-forget-q">怎么忘的？</p>
        <div className="ruled-row">
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
