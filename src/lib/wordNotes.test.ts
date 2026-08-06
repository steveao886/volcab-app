import { describe, expect, it } from 'vitest'
import { wordNote } from './wordNotes'
import type { WordNotesFile } from './wordNotes'

const file: WordNotesFile = {
  version: 1,
  notes: {
    abate: '只形容风暴、疼痛、争议这类坏事自行减弱,主语是坏事本身,不能带宾语。',
    blank: '   ',
  },
}

describe('wordNote', () => {
  it('returns the note for a word that has one', () => {
    expect(wordNote(file, 'abate')).toBe(file.notes.abate)
  })

  it('returns undefined for a word with no note', () => {
    // The common case, not an error: 198 of 498 words have no confusable
    // twin and are meant to stay blank.
    expect(wordNote(file, 'ephemeral')).toBeUndefined()
  })

  it('treats a blank note as no note', () => {
    // An authoring slip that gets past a hand edit of the JSON must render
    // as nothing, not as an empty 要点 heading with a blank line under it.
    expect(wordNote(file, 'blank')).toBeUndefined()
  })

  it('trims surrounding whitespace', () => {
    expect(wordNote({ version: 1, notes: { x: '  要点。 ' } }, 'x')).toBe('要点。')
  })

  it('survives a value that is not a string', () => {
    // Bundled content is hand-edited; the read side is lenient everywhere
    // else in this app and must not white-screen a review session over one
    // malformed entry.
    const bad = { version: 1, notes: { x: 42 } } as unknown as WordNotesFile
    expect(wordNote(bad, 'x')).toBeUndefined()
  })

  it('does not pick up inherited Object properties', () => {
    // A word id can be any lowercase lemma, and "constructor" / "toString"
    // are lemmas. Without this holding, wordNote would hand the render layer
    // a function and the card would print "function Object() { … }".
    expect(wordNote(file, 'constructor')).toBeUndefined()
    expect(wordNote(file, 'toString')).toBeUndefined()
  })
})
