import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import type { Word } from '../types'

/**
 * The two pieces every quiz mode's result page is built from. Six modes
 * printed them six times — a 30px number in a card, then a card holding a
 * list of 34px headwords under 「错词 · N」 — and drifted apart doing it.
 */

/**
 * The score as a readout: the number in ink, its label under it, then one
 * sentence of summary. No box and no accent — a score is a fact, not a mark.
 */
export function ResultScore({ value, label, children }: { value: ReactNode; label: string; children?: ReactNode }) {
  return (
    <div className="quiz-result">
      <div className="readout" role="status">
        <p className="readout__value">{value}</p>
        <p className="readout__label">{label}</p>
      </div>
      {children === undefined ? null : <div className="quiz-result__summary">{children}</div>}
    </div>
  )
}

export interface MissedRow {
  word: Word
  /** Which kind of miss it was, printed on the row (回想's 没想起来, 组句's 顺序错了). */
  tag?: string
}

/**
 * The words a round missed: a ruled list under a section head, the count at
 * the head's right edge, each row opening the word. The headword is set in
 * the list face, not .word — a list of 34px headwords is what CLAUDE.md's
 * `apathetic` clipping was.
 */
export function MissedWords({ title, rows }: { title: string; rows: MissedRow[] }) {
  return (
    <section className="section">
      <h2 className="section-head">
        {title}
        <span className="section-head__aside num">{rows.length}</span>
      </h2>
      <ul className="ledger">
        {rows.map((r, k) => (
          <li key={`${r.word.id}-${k}`}>
            <Link className="ledger__row" to={`/word/${r.word.id}`}>
              <span className="ledger__main">
                <span className="ledger__word" lang="en">{r.word.headword}</span>
                <span className="ledger__secondary">{r.word.meanings[0]?.zh}</span>
              </span>
              {r.tag === undefined ? null : <span className="quiz-missed__tag">{r.tag}</span>}
              <Icon name="chevron" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
