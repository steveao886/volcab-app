import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { ExampleSentence } from '../components/ExampleSentence'
import type { HintRung } from '../lib/forget'
import { isEditableTarget } from '../lib/keys'
import type { Word } from '../types'

/**
 * A blank word's front, one rung at a time: its own sentence with the headword
 * marked, then its etymology up to the arrow (spec §2, rungs from hintRungs).
 *
 * A nudge, never a gate: Space and a click on the card still flip at any rung,
 * which is why 提示 stops its click from reaching the card. The rung count is
 * plain local state, and the review page keys this per showing, so a word that
 * comes round again opens closed.
 *
 * **A mouse click on 提示 does not take focus.** Space flips only while nothing
 * has focus (Review.tsx's window handler leaves a focused control its own
 * Space), so a clicked 提示 would keep Space for itself and open the next rung
 * instead of flipping. Tabbing to it still focuses it, the way the speak
 * button works.
 */
export function HintLadder({ word, rungs }: { word: Word; rungs: HintRung[] }) {
  const [open, setOpen] = useState(0)
  const more = open < rungs.length
  const next = useCallback(() => setOpen((n) => Math.min(n + 1, rungs.length)), [rungs.length])

  // H, printed on the button. Off once the ladder is spent, so the key is
  // never live with nothing on screen to say what it does.
  useEffect(() => {
    if (!more) return
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl+H is the browser's history, and a held H would climb the whole
      // ladder in one press.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key !== 'h' && e.key !== 'H') return
      if (isEditableTarget(document.activeElement)) return
      e.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [more, next])

  return (
    <div className="review-ladder">
      {rungs.slice(0, open).map((r) =>
        r.kind === 'example' ? (
          <div className="review-ladder__rung" key="example">
            <p className="section-title">例句</p>
            <p className="review-ladder__example" lang="en">
              <ExampleSentence sentence={r.sentence} headword={word.headword} />
            </p>
          </div>
        ) : (
          <div className="review-ladder__rung" key="etymology">
            <p className="section-title">词源</p>
            <p className="review-etymology">{r.text}</p>
          </div>
        ),
      )}
      {more && (
        <Button
          variant="secondary"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation() // The card's own click flips it
            next()
          }}
        >
          提示<span className="key">H</span>
        </Button>
      )}
    </div>
  )
}
