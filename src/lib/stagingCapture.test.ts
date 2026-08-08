import { describe, expect, it } from 'vitest'
import { checkCapture, chipCaptureStatus } from './stagingCapture'
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

describe('chipCaptureStatus', () => {
  it('a word you do not have yet is tappable', () => {
    expect(chipCaptureStatus('perfunctory', LIB, STAGE)).toBe('addable')
  })

  it('a blank chip is inert, never a button that would stage nothing', () => {
    // Reaches the card from an older build or another device: the read side
    // is lenient, so collocations can hold a blank string.
    expect(chipCaptureStatus('', LIB, STAGE)).toBe('inert')
    expect(chipCaptureStatus('   ', LIB, STAGE)).toBe('inert')
  })

  it('a word already in the library or already staged is marked, not offered', () => {
    expect(chipCaptureStatus('Abrogate', LIB, STAGE)).toBe('in-library')
    expect(chipCaptureStatus(' OSTENSIBLE ', LIB, STAGE)).toBe('in-staging')
  })

  it('the library wins over staging, so a word you own never reads as pending', () => {
    expect(chipCaptureStatus('abrogate', LIB, [item('abrogate')])).toBe('in-library')
  })

  it('a phrase chip matches its library entry through either spelling', () => {
    // Collocations and phrasal entries are the reason this matters: the chip
    // says "ad hoc" while the library id is "ad-hoc".
    expect(chipCaptureStatus('ad hoc', LIB, STAGE)).toBe('in-library')
    expect(chipCaptureStatus('Ad-Hoc', LIB, STAGE)).toBe('in-library')
  })

  it('a multi-word collocation with no match is staged as written, not split', () => {
    // "culpable negligence" stages whole. Picking out "negligence" would mean
    // guessing which half is the interesting one.
    expect(chipCaptureStatus('culpable negligence', LIB, STAGE)).toBe('addable')
  })
})
