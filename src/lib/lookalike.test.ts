import { describe, expect, it } from 'vitest'
import {
  buildLookalikePairs, diffMarks, generateLookalikeQuiz, lookalikeIndex, lookalikeMissIds, osaDistance,
} from './lookalike'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const TODAY = '2026-10-29'

const w = (headword: string, zh: string, pos = 'v.', synonyms: string[] = []): Word => ({
  id: headword, headword, phonetic: `/${headword}/`,
  meanings: [{ pos, en: `def of ${headword}`, zh }],
  examples: [`They tried to ${headword} it.`], synonyms, antonyms: [], collocations: [],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const studiedOf = (ws: Word[]): Progress => {
  const p = emptyProgress()
  for (const x of ws) {
    p.words[x.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-10-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-09-20T00:00:00Z' }
  }
  return p
}

const ids = (ws: Word[]) => buildLookalikePairs(ws).map(p => `${p.a}|${p.b}`)

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('osaDistance', () => {
  it('counts a swap of two adjacent letters as one edit', () => {
    expect(osaDistance('form', 'from')).toBe(1)
    expect(osaDistance('allude', 'elude')).toBe(2)
    expect(osaDistance('inert', 'inept')).toBe(1)
    expect(osaDistance('same', 'same')).toBe(0)
  })
})

describe('buildLookalikePairs', () => {
  it('pairs words one letter apart', () => {
    expect(ids([w('inert', '一动不动的', 'adj.'), w('inept', '笨拙无能的', 'adj.')])).toEqual(['inept|inert'])
  })

  it('pairs words two edits apart when the rest of the word frames the difference', () => {
    // allude/elude differ only in the opening; `lude` frames 4 of 6 letters
    expect(ids([w('allude', '暗指'), w('elude', '躲避')])).toEqual(['allude|elude'])
    expect(ids([w('imminent', '即将发生的', 'adj.'), w('eminent', '杰出的', 'adj.')])).toEqual(['eminent|imminent'])
  })

  it('does not pair rhymes whose shared part is only a suffix', () => {
    // two edits, but only `ious` is shared: 4 of 7
    expect(ids([w('devious', '狡猾的', 'adj.'), w('tedious', '乏味的', 'adj.')])).toEqual([])
    expect(ids([w('testy', '易怒的', 'adj.'), w('petty', '小气的', 'adj.')])).toEqual([])
  })

  it('does not pair words where one is the other plus an ending', () => {
    expect(ids([w('haste', '匆忙', 'n.'), w('hasten', '加速')])).toEqual([])
    expect(ids([w('nuance', '细微差别', 'n.'), w('nuanced', '细致入微的', 'adj.')])).toEqual([])
  })

  it('does not pair a word with its negation', () => {
    expect(ids([w('resolute', '坚决的', 'adj.'), w('irresolute', '优柔寡断的', 'adj.')])).toEqual([])
  })

  it('does not pair one base in two parts of speech', () => {
    // eminence/eminent: the same idea as a noun and an adjective
    expect(ids([w('eminence', '卓越;显赫', 'n.'), w('eminent', '杰出的,著名的', 'adj.')])).toEqual([])
  })

  it('does pair one base in the same part of speech with different meanings', () => {
    expect(ids([w('precedence', '优先权', 'n.'), w('precedent', '先例;判例', 'n.')])).toEqual(['precedence|precedent'])
  })

  it('does not pair words whose glosses share a term — the trap would be a second right answer', () => {
    expect(ids([w('amiable', '和蔼可亲的;友善的', 'adj.'), w('affable', '和蔼可亲的;平易近人的', 'adj.')])).toEqual([])
  })

  it('ignores 的 and 令人 when comparing glosses', () => {
    // 令人 and 在的 are grammar, not meaning: both pairs share nothing else
    expect(ids([w('appalling', '令人震惊的', 'adj.'), w('appealing', '令人喜欢的;有吸引力的', 'adj.')])).toEqual(['appalling|appealing'])
    expect(ids([w('intrinsic', '内在的;固有的', 'adj.'), w('extrinsic', '外在的;非本质的', 'adj.')])).toEqual(['extrinsic|intrinsic'])
  })

  it('does not pair words already joined as near-synonyms', () => {
    expect(ids([w('rebuke', '斥责', 'v.', ['scold']), w('rebuff', '冷落', 'v.', ['scold'])])).toEqual([])
  })

  it('skips phrases and very short words', () => {
    expect(ids([w('give in', '让步'), w('give up', '放弃')])).toEqual([])
    expect(ids([w('vex', '使恼怒'), w('hex', '诅咒')])).toEqual([])
  })
})

describe('lookalikeIndex', () => {
  it('lists every partner, closest first', () => {
    const ws = [w('condone', '宽恕'), w('condole', '吊唁'), w('convene', '召集')]
    const idx = lookalikeIndex(buildLookalikePairs(ws))
    expect(idx.get('condone')).toEqual(['condole', 'convene'])
    expect(idx.get('condole')).toEqual(['condone'])
  })
})

describe('diffMarks', () => {
  it('marks the letters that differ on each side', () => {
    const [a, b] = diffMarks('inert', 'inept')
    expect(a).toEqual([false, false, false, true, false])
    expect(b).toEqual([false, false, false, true, false])
  })

  it('marks an inserted letter only on the side that has it', () => {
    const [a, b] = diffMarks('averse', 'adverse')
    expect(a.every(x => !x)).toBe(true)
    expect(b).toEqual([false, true, false, false, false, false, false])
  })

  it('marks both letters of a swap', () => {
    const [a, b] = diffMarks('form', 'from')
    expect(a).toEqual([false, true, true, false])
    expect(b).toEqual([false, true, true, false])
  })
})

/** Two look-alike pairs plus enough unrelated words to fill a four-option question. */
const lib = [
  w('allude', '暗指'), w('elude', '躲避'),
  w('inert', '一动不动的', 'adj.'), w('inept', '笨拙无能的', 'adj.'),
  w('mellow', '醇和的', 'adj.'), w('quarry', '采石场', 'n.'), w('zenith', '顶点', 'n.'),
  w('banter', '打趣'), w('fathom', '理解'), w('wither', '枯萎'),
]

describe('generateLookalikeQuiz', () => {
  it('asks a headword with its look-alike partner\'s meaning among four options', () => {
    const qs = generateLookalikeQuiz(lib, studiedOf(lib), TODAY, 10, mulberry(1))
    expect(qs.length).toBe(2)
    for (const q of qs) {
      expect(q.type).toBe('lookalike')
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options).toContain(q.answer)
      expect(q.prompt).toBe(q.wordId)
      expect(q.lookalikes).toHaveLength(1)
      for (const t of q.lookalikes ?? []) expect(q.options).toContain(t.label)
    }
  })

  it('asks each pair once per round — the second side would be answered off the first reveal', () => {
    for (let seed = 0; seed < 20; seed++) {
      const qs = generateLookalikeQuiz(lib, studiedOf(lib), TODAY, 10, mulberry(seed))
      const seen = qs.flatMap(q => [q.wordId, ...(q.lookalikes ?? []).map(t => t.id)])
      expect(new Set(seen).size).toBe(seen.length)
    }
  })

  it('only asks words whose partner is learned too', () => {
    const p = studiedOf(lib.filter(x => x.id !== 'elude'))
    const qs = generateLookalikeQuiz(lib, p, TODAY, 10, mulberry(3))
    expect(qs).toHaveLength(1)
    expect(['inert', 'inept']).toContain(qs[0].wordId)
  })

  it('returns nothing when no learned pair exists', () => {
    expect(generateLookalikeQuiz(lib, emptyProgress(), TODAY, 10, mulberry(1))).toEqual([])
  })

  it('puts recently asked words behind unasked ones', () => {
    const many = [
      ...lib,
      w('condone', '宽恕'), w('condole', '吊唁'),
      w('swindle', '诈骗'), w('dwindle', '逐渐减少'),
    ]
    for (let seed = 0; seed < 20; seed++) {
      const qs = generateLookalikeQuiz(many, studiedOf(many), TODAY, 1, mulberry(seed), ['allude', 'elude', 'inert', 'inept'])
      expect(['condone', 'condole', 'swindle', 'dwindle']).toContain(qs[0].wordId)
    }
  })

  it('never fills with a word whose gloss overlaps a trap — two options meaning one thing eliminate each other', () => {
    // Found by playing: `preside` drew presage's 预示;预兆 as its trap and another
    // word's 预示,预兆 as a filler, side by side.
    const tricky = [...lib, w('shun', '躲避;回避')]
    let asked = 0
    for (let seed = 0; seed < 30; seed++) {
      const qs = generateLookalikeQuiz(tricky, studiedOf(tricky), TODAY, 10, mulberry(seed))
      const q = qs.find(x => x.wordId === 'allude')
      if (q === undefined) continue
      asked++
      expect(q.options).toContain('v. 躲避')
      expect(q.options).not.toContain('v. 躲避;回避')
    }
    expect(asked).toBeGreaterThan(0)
  })

  it('keeps two partners apart from each other as well as from the prompt', () => {
    // condole and convene both pair with condone, not with each other, and share 慰问
    const ws = [...lib, w('condone', '宽恕'), w('condole', '吊唁;慰问'), w('convene', '慰问;召集')]
    let asked = 0
    for (let seed = 0; seed < 30; seed++) {
      const q = generateLookalikeQuiz(ws, studiedOf(ws), TODAY, 10, mulberry(seed)).find(x => x.wordId === 'condone')
      if (q === undefined) continue
      asked++
      expect(q.lookalikes?.map(t => t.id)).toEqual(['condole'])
    }
    expect(asked).toBeGreaterThan(0)
  })

  it('never fills with a word whose gloss overlaps the answer', () => {
    const tricky = [...lib, w('hint', '暗指;暗示')]
    for (let seed = 0; seed < 30; seed++) {
      const qs = generateLookalikeQuiz(tricky, studiedOf(tricky), TODAY, 10, mulberry(seed))
      const q = qs.find(x => x.wordId === 'allude')
      if (q) expect(q.options).not.toContain('v. 暗指;暗示')
    }
  })
})

describe('lookalikeMissIds', () => {
  const q = generateLookalikeQuiz(lib, studiedOf(lib), TODAY, 10, mulberry(1))[0]
  it('marks both words when the partner\'s meaning was picked — the confusion lives in the pair', () => {
    const trap = q.lookalikes?.[0]
    expect(trap).toBeDefined()
    if (trap) expect(lookalikeMissIds(q, trap.label)).toEqual([q.wordId, trap.id])
  })

  it('marks only the asked word on any other wrong pick', () => {
    const other = q.options.find(o => o !== q.answer && !(q.lookalikes ?? []).some(t => t.label === o))
    expect(other).toBeDefined()
    if (other) expect(lookalikeMissIds(q, other)).toEqual([q.wordId])
  })

  it('marks nothing on the right answer', () => {
    expect(lookalikeMissIds(q, q.answer)).toEqual([])
  })
})
