import { describe, expect, it } from 'vitest'
import { checkCapture } from './stagingCapture'
import type { StagingItem, Word } from '../types'

const word = (id: string, headword = id): Word => ({
  id, headword, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

const item = (headword: string): StagingItem => ({ headword, addedAt: '2026-07-25' })

const LIB = [word('abrogate'), word('ad-hoc', 'ad hoc')]
const STAGE = [item('ostensible')]

describe('checkCapture', () => {
  it('empty input (including whitespace-only): the button should be disabled', () => {
    expect(checkCapture('', LIB, STAGE).kind).toBe('empty')
    expect(checkCapture('   \n ', LIB, STAGE).kind).toBe('empty')
  })

  it('a new word: allowed through, returning the normalized spelling', () => {
    expect(checkCapture('  perfunctory ', LIB, STAGE)).toEqual({ kind: 'ok', headword: 'perfunctory' })
    expect(checkCapture('Sine  Qua  Non', LIB, STAGE)).toEqual({ kind: 'ok', headword: 'Sine Qua Non' })
  })

  it('already in the library: blocked, carrying the entry id so the notice can link to it', () => {
    expect(checkCapture('Abrogate', LIB, STAGE)).toEqual({ kind: 'in-library', id: 'abrogate', headword: 'abrogate' })
  })

  it('already in the staging list: blocked', () => {
    expect(checkCapture(' OSTENSIBLE ', LIB, STAGE)).toMatchObject({ kind: 'in-staging' })
  })

  it('phrase entries: both the space and hyphen spellings are recognized as the same word', () => {
    // In the library, headword is "ad hoc" and id is "ad-hoc"; neither input should be enqueued as a duplicate
    expect(checkCapture('ad hoc', LIB, STAGE).kind).toBe('in-library')
    expect(checkCapture('Ad-Hoc', LIB, STAGE).kind).toBe('in-library')
    expect(checkCapture('ad   hoc', LIB, STAGE).kind).toBe('in-library')
  })

  it('the library takes priority over staging: when the same word is in both, the notice points to the already-captured entry', () => {
    expect(checkCapture('abrogate', LIB, [item('abrogate')]).kind).toBe('in-library')
  })

  it('an empty library and empty staging area don\'t cause errors', () => {
    expect(checkCapture('ostensible', [], []).kind).toBe('ok')
  })
})
