import { describe, expect, it } from 'vitest'
import { isShapeGiveaway } from './shapeGiveaway'

describe('containment', () => {
  it('catches a negation prefix without anyone listing the prefixes', () => {
    expect(isShapeGiveaway('fallible', 'infallible')).toBe(true)
    expect(isShapeGiveaway('purity', 'impurity')).toBe(true)
    expect(isShapeGiveaway('hearten', 'dishearten')).toBe(true)
    expect(isShapeGiveaway('pretentious', 'unpretentious')).toBe(true)
    expect(isShapeGiveaway('reducible', 'irreducible')).toBe(true)
    expect(isShapeGiveaway('delegable', 'non-delegable')).toBe(true)
  })

  it('is symmetric — which side is the prompt is the caller\'s business', () => {
    expect(isShapeGiveaway('infallible', 'fallible')).toBe(true)
    expect(isShapeGiveaway('inconspicuous', 'conspicuous')).toBe(true)
  })

  it('catches containment that is not a negation at all', () => {
    // synonymHint's half of the leak: the hint contains the answer outright.
    expect(isShapeGiveaway('topple', 'topple over')).toBe(true)
    expect(isShapeGiveaway('mire', 'quagmire')).toBe(true)
    expect(isShapeGiveaway('mime', 'pantomime')).toBe(true)
    expect(isShapeGiveaway('begrudge', 'grudge')).toBe(true)
    expect(isShapeGiveaway('entanglement', 'tangle')).toBe(true)
  })

  /**
   * The 4-character floor. `ire` sits inside `admire`, `end` inside
   * `commend`, `ail` inside `curtail` — none of which tells a learner
   * anything. Without the floor the rule would delete good questions on
   * three-letter coincidences.
   */
  it('ignores a short string landing inside an unrelated long one', () => {
    expect(isShapeGiveaway('ire', 'admire')).toBe(false)
    expect(isShapeGiveaway('end', 'commend')).toBe(false)
    expect(isShapeGiveaway('ail', 'curtail')).toBe(false)
  })

  it('is case- and whitespace-insensitive, the way contrast.ts normalizes', () => {
    expect(isShapeGiveaway('  FALLIBLE ', 'Infallible')).toBe(true)
  })

  it('a word is not a giveaway against itself — that is a duplicate, not a leak', () => {
    expect(isShapeGiveaway('candor', 'candor')).toBe(false)
  })
})

describe('-ful / -less swap', () => {
  /** Containment cannot reach these: neither string contains the other. */
  it('catches the swap containment misses', () => {
    expect(isShapeGiveaway('artful', 'artless')).toBe(true)
    expect(isShapeGiveaway('artless', 'artful')).toBe(true)
    expect(isShapeGiveaway('effortful', 'effortless')).toBe(true)
  })

  it('does not fire on two words that merely both end in -less', () => {
    expect(isShapeGiveaway('reckless', 'ruthless')).toBe(false)
  })
})

describe('one-token multiword difference', () => {
  it('catches a phrase pair differing in exactly one content-bearing slot', () => {
    expect(isShapeGiveaway('level playing field', 'tilted playing field')).toBe(true)
    expect(isShapeGiveaway('race to the bottom', 'race to the top')).toBe(true)
    expect(isShapeGiveaway('with a pinch of salt', 'with a grain of salt')).toBe(true)
    expect(isShapeGiveaway('fall through', 'fall apart')).toBe(true)
  })

  /**
   * The content-word guard, which is the whole reason this clause is
   * safe. Sharing a preposition hands over nothing — a learner still has
   * to know the verb. Without the guard all four of these are flagged and
   * four good questions die.
   */
  it('does not fire when the only shared tokens are function words', () => {
    expect(isShapeGiveaway('stem from', 'arise from')).toBe(false)
    expect(isShapeGiveaway('stem from', 'derive from')).toBe(false)
    expect(isShapeGiveaway('account for', 'answer for')).toBe(false)
    expect(isShapeGiveaway('in the wake of', 'in the aftermath of')).toBe(false)
  })

  it('does not fire on phrases of different lengths or with two tokens differing', () => {
    expect(isShapeGiveaway('give rise to', 'result in')).toBe(false)
    expect(isShapeGiveaway('at face value', 'without question')).toBe(false)
  })

  it('needs both sides multiword — a single word pair is containment\'s job', () => {
    expect(isShapeGiveaway('candor', 'trickery')).toBe(false)
  })
})

/**
 * A looser "shared leading stem of N characters" rule was tried and
 * rejected: it reads as more general and is simply wrong. Every pair below
 * shares four or more leading characters and none of them leaks — sharing
 * `inter-` or `super-` is not a hint, it is six words a learner has to
 * know one at a time.
 *
 * These are asserted rather than described so the next attempt at a
 * looser rule fails a test instead of shipping. See
 * docs/superpowers/specs/2026-08-19-antonym-giveaway-and-external-design.md.
 */
describe('the stem rule that was rejected', () => {
  it('leaves words that merely share a Latin prefix alone', () => {
    expect(isShapeGiveaway('contentious', 'controversial')).toBe(false)
    expect(isShapeGiveaway('intercede', 'intervene')).toBe(false)
    expect(isShapeGiveaway('interlude', 'interval')).toBe(false)
    expect(isShapeGiveaway('irreparable', 'irreversible')).toBe(false)
    expect(isShapeGiveaway('intersperse', 'interlace')).toBe(false)
    expect(isShapeGiveaway('superintend', 'supervise')).toBe(false)
    expect(isShapeGiveaway('approbation', 'approval')).toBe(false)
    expect(isShapeGiveaway('pretense', 'pretext')).toBe(false)
  })

  /**
   * Knowingly let through, and the price of the tight rule: these do leak
   * a little, and every rule loose enough to catch them also catches the
   * eight above. Asserted so the tradeoff is visible rather than assumed.
   */
  it('also lets through the derivations it cannot separate from those', () => {
    expect(isShapeGiveaway('commensurate', 'commensurable')).toBe(false)
    expect(isShapeGiveaway('oxidization', 'oxidation')).toBe(false)
  })
})

describe('unrelated words', () => {
  it('says no to the ordinary case', () => {
    expect(isShapeGiveaway('garrulous', 'taciturn')).toBe(false)
    expect(isShapeGiveaway('auspicious', 'ominous')).toBe(false)
    expect(isShapeGiveaway('alleviate', 'exacerbate')).toBe(false)
  })

  it('treats a blank as no relation rather than matching everything', () => {
    // The same trap antonym.ts and contrast.ts guard: an empty string is
    // inside every other string, so containment alone would flag the lot.
    expect(isShapeGiveaway('', 'fallible')).toBe(false)
    expect(isShapeGiveaway('fallible', '   ')).toBe(false)
  })
})
