import { describe, expect, it } from 'vitest'
import { piecesText, requiredFields, verbForms } from './verbForms'
import type { Piece, VerbFormsEntry, VerbFormsFile } from './verbForms'

const verb = (headword: string, pos: string[] = ['v.']) => ({
  id: headword.replace(/\s+/g, '-'),
  headword,
  meanings: pos.map(p => ({ pos: p, en: 'x', zh: 'x' })),
})

const file = (verbs: Record<string, VerbFormsEntry> = {}): VerbFormsFile => ({ version: 1, verbs })

/** A form as text with its marked letters in brackets: `concu[rr]ed`. */
const show = (pieces: Piece[]) => pieces.map(p => (p.mark ? `[${p.text}]` : p.text)).join('')

describe('verbForms: regular spelling', () => {
  it('returns null for a word with no verb sense', () => {
    expect(verbForms(verb('placid', ['adj.']), file())).toBeNull()
  })

  it('spells a plain regular verb and marks nothing', () => {
    const f = verbForms(verb('overhaul', ['v.', 'n.']), file())
    expect(f?.kind).toBe('regular')
    expect([f?.past, f?.pastParticiple, f?.presentParticiple, f?.thirdPerson].map(p => show(p ?? []))).toEqual([
      'overhauled', 'overhauled', 'overhauling', 'overhauls',
    ])
  })

  it('applies the y, e, ie, ee and o rules', () => {
    const forms = (h: string) => {
      const f = verbForms(verb(h), file())
      return f && [f.past, f.presentParticiple, f.thirdPerson].map(piecesText).join(' ')
    }
    expect(forms('ratify')).toBe('ratified ratifying ratifies')
    expect(forms('obey')).toBe('obeyed obeying obeys')
    expect(forms('abate')).toBe('abated abating abates')
    expect(forms('vie')).toBe('vied vying vies')
    expect(forms('decree')).toBe('decreed decreeing decrees')
    expect(forms('abolish')).toBe('abolished abolishing abolishes')
    expect(forms('veto')).toBe('vetoed vetoing vetoes')
  })

  it('shows forms when the verb is a secondary sense', () => {
    expect(verbForms(verb('censure', ['n.', 'v.']), file())?.kind).toBe('regular')
  })
})

describe('verbForms: doubling', () => {
  it('doubles a one-syllable consonant-vowel-consonant word on its own and marks the pair', () => {
    const f = verbForms(verb('snag'), file())
    expect(f?.kind).toBe('double')
    expect(f?.consonant).toBe('g')
    expect(show(f!.past)).toBe('sna[gg]ed')
    expect(show(f!.presentParticiple)).toBe('sna[gg]ing')
    expect(show(f!.thirdPerson)).toBe('snags')
  })

  it('fails closed on a longer consonant-vowel-consonant word with no entry', () => {
    expect(verbForms(verb('concur'), file())).toBeNull()
  })

  it('doubles a longer word when its entry says so', () => {
    const f = verbForms(verb('concur'), file({ concur: { double: true } }))
    expect(f?.kind).toBe('double')
    expect(show(f!.past)).toBe('concu[rr]ed')
  })

  it('leaves a longer word single when its entry says so, unmarked unless it looks doubled', () => {
    expect(verbForms(verb('ponder'), file({ ponder: { double: false } }))?.kind).toBe('regular')
    const f = verbForms(verb('fidget'), file({ fidget: { double: false, looksDoubled: true } }))
    expect(f?.kind).toBe('single')
    expect(f?.consonant).toBe('t')
    expect(show(f!.past)).toBe('fidge[t]ed')
    expect(show(f!.presentParticiple)).toBe('fidge[t]ing')
    expect(show(f!.thirdPerson)).toBe('fidgets')
  })

  it('treats qu as one consonant', () => {
    expect(requiredFields('equip')).toEqual(['double'])
  })
})

describe('verbForms: irregular', () => {
  it('fails closed on an irregular verb with no entry', () => {
    expect(verbForms(verb('oversee'), file())).toBeNull()
  })

  it('takes the entry and marks each form that differs from the rules', () => {
    const f = verbForms(verb('oversee'), file({ oversee: { past: 'oversaw', pastParticiple: 'overseen' } }))
    expect(f?.kind).toBe('irregular')
    expect(show(f!.past)).toBe('[oversaw]')
    expect(show(f!.pastParticiple)).toBe('[overseen]')
    expect(show(f!.presentParticiple)).toBe('overseeing')
    expect(show(f!.thirdPerson)).toBe('oversees')
  })

  it('marks an irregular form even when it is the base unchanged', () => {
    const f = verbForms(verb('cast a long shadow'), file({ 'cast-a-long-shadow': { past: 'cast', pastParticiple: 'cast' } }))
    expect(show(f!.past)).toBe('[cast] a long shadow')
  })

  it('reads an entry that writes out regular forms as regular', () => {
    const f = verbForms(verb('belie'), file({ belie: { past: 'belied', pastParticiple: 'belied' } }))
    expect(f?.kind).toBe('regular')
    expect(show(f!.past)).toBe('belied')
  })

  it('ignores a malformed entry, and so fails closed', () => {
    const bad = { past: 'Oversaw', pastParticiple: 3 } as unknown as VerbFormsEntry
    expect(verbForms(verb('oversee'), file({ oversee: bad }))).toBeNull()
  })
})

describe('verbForms: multi-word headwords', () => {
  it('inflects the first word of a phrase', () => {
    const f = verbForms(verb('fall through'), file({ 'fall-through': { past: 'fell', pastParticiple: 'fallen' } }))
    expect(show(f!.past)).toBe('[fell] through')
    expect(show(f!.pastParticiple)).toBe('[fallen] through')
    expect(show(f!.presentParticiple)).toBe('falling through')
    expect(show(f!.thirdPerson)).toBe('falls through')
  })

  it('doubles the first word of a phrase by the same rule', () => {
    expect(show(verbForms(verb('stem from'), file())!.past)).toBe('ste[mm]ed from')
  })

  it('inflects the last segment of a hyphenated compound', () => {
    const f = verbForms(verb('rubber-stamp'), file())
    expect(f?.kind).toBe('regular')
    expect(show(f!.past)).toBe('rubber-stamped')
    expect(show(f!.thirdPerson)).toBe('rubber-stamps')
  })
})

describe('requiredFields', () => {
  it('asks nothing of a word the rules can spell', () => {
    expect(requiredFields('overhaul')).toEqual([])
    expect(requiredFields('snag')).toEqual([])
  })

  it('asks for past and participle on an irregular verb, behind any number of prefixes', () => {
    expect(requiredFields('uphold')).toEqual(['past', 'pastParticiple'])
    expect(requiredFields('misunderstand')).toEqual(['past', 'pastParticiple'])
  })

  it('asks an irregular verb that also ends consonant-vowel-consonant for both', () => {
    expect(requiredFields('forget')).toEqual(['past', 'pastParticiple', 'double'])
  })

  it('asks for a doubling decision on a longer consonant-vowel-consonant word', () => {
    expect(requiredFields('concur')).toEqual(['double'])
  })

  it('asks for every form the rules cannot spell from a c or an s/z ending', () => {
    expect(requiredFields('panic')).toEqual(['past', 'pastParticiple', 'presentParticiple'])
    expect(requiredFields('quiz')).toEqual(['past', 'pastParticiple', 'presentParticiple', 'thirdPerson'])
  })
})
