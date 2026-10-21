import { Fragment } from 'react'
import { BLANK } from '../lib/quiz'

/**
 * A cloze prompt with each blank in its own span, so the page can draw the gap
 * as a ruled line to write on rather than three underscores. It splits on the
 * very constant clozeExample writes, so a change to the blank cannot leave a
 * renderer looking for the old one. QuizQuestion and 今天混过的词 each held a
 * verbatim copy of this, with its own copy of the constant, until 2026-10-21,
 * when the tangle session was about to make a third.
 *
 * **The class is the caller's**, not one shared name. Each page styles its
 * gap inside its own layout, and a shared class name is a layout contract
 * (CLAUDE.md, the `.quiz-progress` and `.word` bugs): `.quiz-blank` belongs to
 * the quiz page and must not start governing the review page's done screen.
 *
 * The underscores stay in the DOM, so a copy and paste still shows where the
 * gap was.
 */
export function Blanked({ text, blankClass }: { text: string; blankClass: string }) {
  const parts = text.split(BLANK)
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? <span className={blankClass}>{BLANK}</span> : null}
        </Fragment>
      ))}
    </>
  )
}
