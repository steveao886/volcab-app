import { splitByHeadword } from '../lib/headword'

/**
 * Example sentence with the headword (including inflected forms) highlighted.
 *
 * Uses <mark> rather than <span>: semantically it's "a passage marked for
 * ease of reference," and screen readers announce it accordingly. The
 * default yellow highlight clashes with the ink-and-paper look, so
 * .example-hit overrides it.
 *
 * Renders the sentence as-is when the headword can't be located — the
 * highlight is a nice-to-have, not something that should ever cause content
 * to go missing.
 */
export function ExampleSentence({ sentence, headword }: { sentence: string; headword: string }) {
  return (
    <>
      {splitByHeadword(sentence, headword).map((seg, i) =>
        seg.hit ? (
          <mark className="example-hit" key={i}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
