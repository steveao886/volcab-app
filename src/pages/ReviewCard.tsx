import { CaptureChips } from '../components/CaptureChips'
import { ExampleSentence } from '../components/ExampleSentence'
import wordNotesFile from '../data/wordNotes.json'
import { wordNote } from '../lib/wordNotes'
import type { WordNotesFile } from '../lib/wordNotes'
import type { Word } from '../types'

/**
 * Content shown on the back of a review card: phonetic + all meanings +
 * examples + synonyms/antonyms + collocations + related forms.
 * Split into its own component because this content is a lot heavier than
 * the front (headword + pronunciation), and every section needs to not
 * render at all when its array is empty — keeping it in its own file makes
 * that rule easier to see at a glance.
 */

function TagRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="review-tags">
      <p className="review-tags__label section-title">{label}</p>
      <CaptureChips className="review-tags__row" items={items.map(item => ({ word: item }))} />
    </div>
  )
}

export function ReviewCardBack({ word }: { word: Word }) {
  const showIndex = word.meanings.length > 1
  const note = wordNote(wordNotesFile as WordNotesFile, word.id)

  return (
    <div className="review-back">
      {/* The phonetic as a whole is aria-hidden (a screen reader reading
          IPA out loud just produces gibberish), but the usage score must
          be readable — so it's a separate element on the same row, and
          can't be stuffed inside .ipa. */}
      <div className="review-back__head">
        <p className="ipa" lang="en" aria-hidden="true">
          {word.phonetic}
        </p>
        {word.usageScore !== undefined && (
          <p className="review-usage">
            <span className="faint">遇见概率</span>{' '}
            <span className="num review-usage__value">{word.usageScore}</span>
            <span className="faint num">/10</span>
          </p>
        )}
      </div>

      <ol className="review-meanings">
        {word.meanings.map((m, i) => (
          <li className="review-meaning" key={`${m.pos}-${i}`}>
            <p className="review-meaning__head">
              {showIndex && <span className="review-meaning__idx num faint">{i + 1}</span>}
              <span className="pos">{m.pos}</span>
              {/* Only present on a heteronym: the phonetic above the meanings
                  is the word-level one and cannot be true of both senses. */}
              {m.phonetic !== undefined && (
                <span className="ipa" lang="en">
                  {m.phonetic}
                </span>
              )}
              {/* The share value uses .faint, a marginal note rather than
                  the protagonist: the first thing seen after flipping
                  should be the English meaning. The data layer already
                  sorts by share descending (see
                  scripts/validate-words.ts), so this doesn't sort — which
                  means the index number above incidentally doubles as
                  frequency-of-use order. */}
              {m.share !== undefined && (
                <span className="num faint review-meaning__share">{m.share}%</span>
              )}
            </p>
            {/* Deliberate choice: the English meaning uses full-weight body
                color, the Chinese meaning drops one notch to .muted. This
                library targets C1/C2 (the difficulty of words like
                circumlocution / grandiloquence), and after flipping, review
                should first go through recalling and confirming via
                "understanding English in English" using the English
                meaning — this is also the tradeoff the page's "dictionary
                typography" visual direction calls for: in a dictionary,
                the headword is defined in its own language, and the
                translation is a marginal note. The Chinese translation is
                still present and readable at any time, it just isn't the
                primary target. This isn't "Chinese doesn't matter" — it's
                deliberately anchoring the cognitive goal on the English
                meaning. */}
            <p lang="en">{m.en}</p>
            <p className="muted">{m.zh}</p>
          </li>
        ))}
      </ol>

      {/* The usage note sits directly under the meanings and above the
          examples, because it is a qualification *of* the meaning: "减弱"
          is true of abate, and useless until you also know only bad things
          can do the abating and nothing can be abated. Reading it after the
          examples would be reading it after already having built the wrong
          mental model from them.
          Most words have no note (see lib/wordNotes.ts) and render nothing
          here at all, the same rule the etymology block follows. */}
      {note !== undefined && (
        <div className="review-tags">
          <p className="review-tags__label section-title">要点</p>
          <p className="review-note">{note}</p>
        </div>
      )}

      {word.examples.length > 0 && (
        <div className="review-tags">
          <p className="review-tags__label section-title">例句</p>
          <ul className="review-examples">
            {word.examples.map((ex) => (
              <li key={ex} lang="en">
                <ExampleSentence sentence={ex} headword={word.headword} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {word.synonyms.length > 0 && <TagRow label="近义词" items={word.synonyms} />}
      {word.antonyms.length > 0 && <TagRow label="反义词" items={word.antonyms} />}
      {word.collocations.length > 0 && <TagRow label="搭配" items={word.collocations} />}

      {/* Etymology sits right next to related forms: they're two halves of
          the same story — where the root came from, and what other words
          that root has grown into. Separating them would break the
          "learn as a word family" thread.
          Words without an etymology (roughly 30-40%) render nothing for
          this whole block, rather than leaving an empty heading. */}
      {word.etymology !== undefined && (
        <div className="review-tags">
          <p className="review-tags__label section-title">词源</p>
          <p className="review-etymology">{word.etymology}</p>
        </div>
      )}

      {word.relatedForms.length > 0 && (
        <div className="review-tags">
          <p className="review-tags__label section-title">同根词</p>
          <CaptureChips
            className="review-tags__row"
            items={word.relatedForms.map(rf => ({
              word: rf.form,
              label: (
                <>
                  <span lang="en">{rf.form}</span>
                  <span className="chip__pos">{rf.pos}</span>
                  {rf.zh}
                </>
              ),
            }))}
          />
        </div>
      )}
    </div>
  )
}
