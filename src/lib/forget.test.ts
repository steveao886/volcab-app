import { describe, expect, it } from 'vitest'
import type { ForgetRecord, ProgressEntry, Word } from '../types'
import type { ContrastPair } from './contrast'
import {
  FORGET_LOG_LIMIT, FORGET_OPTION_LIMIT, appendForget, forgetOptions, glossTerms, hintRungs,
  isLapse, latestForgetToday, needsHintLadder,
} from './forget'

/** A fixture word: `zh` is one meaning each, so `zh[0]` is meanings[0]. */
const w = (id: string, zh: string[], examples: string[] = [], etymology?: string): Word => ({
  id, headword: id, phonetic: '', sourceNote: 'test', addedAt: '2026-10-20',
  meanings: zh.map((z) => ({ pos: 'v.', en: id, zh: z })),
  examples, synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  ...(etymology === undefined ? {} : { etymology }),
})

const pair = (a: string, b: string, score: number): ContrastPair => ({
  a: a < b ? a : b, b: a < b ? b : a, shared: [], direct: false, score,
})

const byIdOf = (...words: Word[]) => new Map(words.map((x) => [x.id, x]))

const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 10, due: '2026-10-25',
  stepIndex: 0, reps: 3, lapses: 1, lastReviewedAt: '2026-10-20T08:00:00.000Z', ...over,
})

const TODAY = '2026-10-20'
/** An ISO timestamp that is `day` at local noon, so todayStr(new Date(...)) reads back `day` in any timezone. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString()
const rec = (over: Partial<ForgetRecord> = {}): ForgetRecord => ({
  at: at(2026, 10, 20), kind: 'blank', prevInterval: 10, prevReviewedAt: '2026-10-10T00:00:00.000Z', ...over,
})

describe('isLapse', () => {
  it('is only a 重来 on a review-phase entry', () => {
    expect(isLapse(entry({ state: 'review' }), 'again')).toBe(true)
  })
  it('is not one on a learning-step card, which is how a relearning showing after a lapse stays quiet', () => {
    expect(isLapse(entry({ state: 'learning', stepIndex: 1 }), 'again')).toBe(false)
  })
  it('is not one on a card that has never been graded', () => {
    expect(isLapse(undefined, 'again')).toBe(false)
  })
  it('is not one when the grade was anything but 重来', () => {
    for (const g of ['hard', 'good', 'easy'] as const) expect(isLapse(entry({ state: 'review' }), g)).toBe(false)
  })
})

describe('glossTerms', () => {
  it('splits on ; ； , ， 、, drops parenthesized qualifiers and a trailing 的/地', () => {
    expect(glossTerms('减轻;缓解(痛苦、问题)')).toEqual(['减轻', '缓解'])
    expect(glossTerms('炫耀的,卖弄的')).toEqual(['炫耀', '卖弄'])
    expect(glossTerms('陡峭地；急剧地，突然地、骤然')).toEqual(['陡峭', '急剧', '突然', '骤然'])
  })
  it('drops a full-width （…） qualifier too, before splitting on the 、 inside it', () => {
    expect(glossTerms('颁布,实施（法令、法规）')).toEqual(['颁布', '实施'])
    expect(glossTerms('(使)陷入泥沼/困境')).toEqual(['陷入泥沼/困境'])
  })
  it('drops what is left empty, and leaves an inner … alone', () => {
    expect(glossTerms('(货币);;地,证明…正确')).toEqual(['证明…正确'])
    expect(glossTerms('')).toEqual([])
  })
})

describe('forgetOptions', () => {
  const corroborate = w('corroborate', ['证实;确证'])
  const vindicate = w('vindicate', ['证明…正确;证实'])
  const substantiate = w('substantiate', ['证实;证明'])

  it("removes the answer's own gloss terms, so an option never restates the answer", () => {
    const pairs = [pair('corroborate', 'vindicate', 5), pair('corroborate', 'substantiate', 4)]
    const studied = new Set(['corroborate', 'vindicate', 'substantiate'])
    expect(forgetOptions(corroborate, byIdOf(corroborate, vindicate, substantiate), studied, pairs)).toEqual([
      { partnerId: 'vindicate', text: '证明…正确' },
      { partnerId: 'substantiate', text: '证明' },
    ])
  })

  it('reads the pair from either side, by score descending and then partner id ascending', () => {
    const x = w('x', ['甲'])
    const b = w('b', ['乙']), c = w('c', ['丙']), d = w('d', ['丁'])
    const pairs = [pair('x', 'd', 3), pair('c', 'x', 3), pair('b', 'x', 1)]
    const got = forgetOptions(x, byIdOf(x, b, c, d), new Set(['b', 'c', 'd']), pairs)
    expect(got.map((o) => o.partnerId)).toEqual(['c', 'd', 'b'])
  })

  it("drops a partner with nothing left: every term is already one of the answer's", () => {
    const x = w('x', ['证实;确证'])
    const same = w('same', ['确证;证实'])
    const oneLeft = w('oneLeft', ['确证;验明'])
    const pairs = [pair('x', 'same', 9), pair('x', 'oneLeft', 8)]
    const got = forgetOptions(x, byIdOf(x, same, oneLeft), new Set(['same', 'oneLeft']), pairs)
    expect(got).toEqual([{ partnerId: 'oneLeft', text: '验明' }])
  })

  it("drops a partner term that sits inside the answer's joined text without being a whole gloss there", () => {
    // 证实 is not a gloss term of x ('使…得以证实' is) but it sits inside x's text.
    const x = w('x', ['拖延', '使…得以证实'])
    const p = w('p', ['证实'])
    expect(forgetOptions(x, byIdOf(x, p), new Set(['p']), [pair('x', 'p', 5)])).toEqual([])
  })

  it("drops a partner term equal to one of the answer's own glosses even where the qualifier sat mid-term", () => {
    // glossTerms cuts 证明(某人)无罪 to 证明无罪, which is not a substring of the
    // text it came from — the shape `vindicate`, `conflate` and `inflict` have.
    const x = w('x', ['证明…正确;证实;证明(某人)无罪'])
    const p = w('p', ['证明无罪;昭雪'])
    expect(forgetOptions(x, byIdOf(x, p), new Set(['p']), [pair('x', 'p', 5)])).toEqual([
      { partnerId: 'p', text: '昭雪' },
    ])
  })

  it("takes terms from all of the answer's meanings but the partner's first only", () => {
    const x = w('x', ['拖延', '搁置'])
    const p = w('p', ['搁置', '推迟'], [])
    const q = w('q', ['推迟;搁置;耽搁'])
    const got = forgetOptions(x, byIdOf(x, p, q), new Set(['p', 'q']), [pair('x', 'p', 5), pair('x', 'q', 4)])
    // p's meanings[0] is entirely x's second sense -> dropped; its second sense 推迟 is never read.
    expect(got).toEqual([{ partnerId: 'q', text: '推迟;耽搁' }])
  })

  it('skips a partner the user has not studied, or whose word no longer exists', () => {
    const x = w('x', ['甲'])
    const studiedP = w('studied', ['乙'])
    const fresh = w('fresh', ['丙'])
    const pairs = [pair('x', 'fresh', 9), pair('x', 'gone', 8), pair('x', 'studied', 1)]
    const got = forgetOptions(x, byIdOf(x, studiedP, fresh), new Set(['studied', 'gone']), pairs)
    expect(got).toEqual([{ partnerId: 'studied', text: '乙' }])
  })

  it('merges identical text by keeping the highest-scored partner', () => {
    const x = w('x', ['甲'])
    const p = w('p', ['乙;丙']), q = w('q', ['乙;丙']), r = w('r', ['丙;乙'])
    const pairs = [pair('x', 'q', 5), pair('x', 'p', 5), pair('x', 'r', 1)]
    const got = forgetOptions(x, byIdOf(x, p, q, r), new Set(['p', 'q', 'r']), pairs)
    // p and q tie on score, so p (id ascending) holds 乙;丙; q repeats it; r's order differs, so it is a different text.
    expect(got).toEqual([
      { partnerId: 'p', text: '乙;丙' },
      { partnerId: 'r', text: '丙;乙' },
    ])
  })

  it(`caps the list at ${FORGET_OPTION_LIMIT}, taking the closest partners`, () => {
    const x = w('x', ['甲'])
    const partners = Array.from({ length: 9 }, (_, i) => w(`p${i}`, [`义${i}`]))
    const pairs = partners.map((p, i) => pair('x', p.id, 100 - i))
    const got = forgetOptions(x, byIdOf(x, ...partners), new Set(partners.map((p) => p.id)), pairs)
    expect(got.map((o) => o.partnerId)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('returns nothing for a word with no pairs', () => {
    expect(forgetOptions(w('x', ['甲']), byIdOf(), new Set(), [])).toEqual([])
  })
})

describe('appendForget', () => {
  it(`keeps the last ${FORGET_LOG_LIMIT} and never touches the scheduler's fields`, () => {
    const start = entry({ ease: 1.9, intervalDays: 0, due: '2026-10-20', lapses: 4, state: 'review' })
    let e = start
    for (let i = 1; i <= FORGET_LOG_LIMIT + 1; i++) {
      e = appendForget(e, rec({ at: at(2026, 10, i), prevInterval: i }))
    }
    expect(e.forgot).toHaveLength(FORGET_LOG_LIMIT)
    expect(e.forgot?.map((r) => r.prevInterval)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect({
      ease: e.ease, intervalDays: e.intervalDays, due: e.due, lapses: e.lapses, state: e.state,
      lastReviewedAt: e.lastReviewedAt,
    }).toEqual({
      ease: start.ease, intervalDays: start.intervalDays, due: start.due, lapses: start.lapses,
      state: start.state, lastReviewedAt: start.lastReviewedAt,
    })
  })

  it('starts the log on an entry that has none, and does not mutate the one it was given', () => {
    const before = entry()
    const after = appendForget(before, rec())
    expect(after.forgot).toEqual([rec()])
    expect(before.forgot).toBeUndefined()
    const withLog = entry({ forgot: [rec({ at: at(2026, 10, 1) })] })
    appendForget(withLog, rec())
    expect(withLog.forgot).toHaveLength(1)
  })

  it('starts over rather than throwing on a log that is not an array', () => {
    const broken = entry({ forgot: 7 as unknown as ForgetRecord[] })
    expect(appendForget(broken, rec()).forgot).toEqual([rec()])
  })
})

describe('latestForgetToday / needsHintLadder', () => {
  it('needs the ladder after a 一片空白 today', () => {
    expect(needsHintLadder(entry({ forgot: [rec({ kind: 'blank' })] }), TODAY)).toBe(true)
  })
  it('needs it after 想成了别的 with no partner, where the meaning matched nothing offered', () => {
    expect(needsHintLadder(entry({ forgot: [rec({ kind: 'confused' })] }), TODAY)).toBe(true)
  })
  it('does not after 想成了别的 with a partner, or with the word itself', () => {
    expect(needsHintLadder(entry({ forgot: [rec({ kind: 'confused', with: 'vindicate' })] }), TODAY)).toBe(false)
    expect(needsHintLadder(entry({ forgot: [rec({ kind: 'confused', with: 'self' })] }), TODAY)).toBe(false)
  })
  // 没想全 names no partner either, so a rule keyed on `with` alone ladders it.
  it('does not after 没想全, where the word came back but not all of it', () => {
    expect(needsHintLadder(entry({ forgot: [rec({ kind: 'partial' })] }), TODAY)).toBe(false)
  })
  it('reads a 没想全 as the latest record, over a 一片空白 earlier the same day', () => {
    const early = rec({ at: at(2026, 10, 20, 8), kind: 'blank' })
    const late = rec({ at: at(2026, 10, 20, 15), kind: 'partial' })
    expect(latestForgetToday(entry({ forgot: [early, late] }), TODAY)).toEqual(late)
    expect(needsHintLadder(entry({ forgot: [early, late] }), TODAY)).toBe(false)
  })
  it("does not for yesterday's record, or for a word with no log", () => {
    expect(needsHintLadder(entry({ forgot: [rec({ at: at(2026, 10, 19) })] }), TODAY)).toBe(false)
    expect(needsHintLadder(entry(), TODAY)).toBe(false)
    expect(needsHintLadder(undefined, TODAY)).toBe(false)
  })
  it("reads the day in local time, as todayStr does, not the timestamp's UTC date", () => {
    // 00:30 local on the 20th is still the 19th in UTC in any timezone east of it.
    expect(latestForgetToday(entry({ forgot: [rec({ at: at(2026, 10, 20, 0) })] }), TODAY)).toBeDefined()
    expect(latestForgetToday(entry({ forgot: [rec({ at: at(2026, 10, 19, 23) })] }), TODAY)).toBeUndefined()
  })
  it("returns today's latest record when yesterday's and an earlier one today sit before it", () => {
    const early = rec({ at: at(2026, 10, 20, 8), kind: 'blank' })
    const late = rec({ at: at(2026, 10, 20, 15), kind: 'confused', with: 'vindicate' })
    const old = rec({ at: at(2026, 10, 19), kind: 'blank' })
    expect(latestForgetToday(entry({ forgot: [old, early, late] }), TODAY)).toEqual(late)
    expect(needsHintLadder(entry({ forgot: [old, early, late] }), TODAY)).toBe(false)
  })

  // Login and cached boot reach the store without mergeProgress, so these two
  // are the last line against a hand-edited or half-written entry.
  it('skips what it cannot read rather than throwing', () => {
    const good = rec({ kind: 'blank' })
    const junk = [null, 7, 'x', [], { at: 5, kind: 'blank' }, { at: at(2026, 10, 20), kind: 'sulked' }, {}]
    const mixed = entry({ forgot: [good, ...junk] as unknown as ForgetRecord[] })
    expect(() => latestForgetToday(mixed, TODAY)).not.toThrow()
    expect(latestForgetToday(mixed, TODAY)).toEqual(good)
    expect(needsHintLadder(entry({ forgot: junk as unknown as ForgetRecord[] }), TODAY)).toBe(false)
    expect(needsHintLadder(entry({ forgot: 7 as unknown as ForgetRecord[] }), TODAY)).toBe(false)
    expect(needsHintLadder(entry({ forgot: { at: at(2026, 10, 20), kind: 'blank' } as unknown as ForgetRecord[] }), TODAY)).toBe(false)
  })
  it('treats a timestamp that is not a date as not today', () => {
    expect(latestForgetToday(entry({ forgot: [rec({ at: 'yesterday-ish' })] }), TODAY)).toBeUndefined()
  })
})

describe('hintRungs', () => {
  const CORROBORATE_ETYM = 'cor-(加强) + robur(力量) → 加固 → 证实'

  it('gives the first example that locates the headword, then the etymology up to its first →', () => {
    const word = w(
      'corroborate',
      ['证实'],
      ['Nothing here names the word.', 'A second witness came forward to corroborate her story.', 'Another sentence that would corroborate it.'],
      CORROBORATE_ETYM,
    )
    expect(hintRungs(word)).toEqual([
      { kind: 'example', sentence: 'A second witness came forward to corroborate her story.' },
      { kind: 'etymology', text: 'cor-(加强) + robur(力量)' },
    ])
  })

  it('never hands over what follows the arrow, which is the answer', () => {
    const word = w('corroborate', ['证实'], ['He will corroborate it.'], CORROBORATE_ETYM)
    const text = JSON.stringify(hintRungs(word))
    expect(text).not.toContain('加固')
    expect(text).not.toContain('证实')
  })

  it('has no etymology rung when there is no etymology', () => {
    expect(hintRungs(w('corroborate', ['证实'], ['He will corroborate it.']))).toEqual([
      { kind: 'example', sentence: 'He will corroborate it.' },
    ])
  })

  it('has no etymology rung when there is no arrow to cut at, or nothing before it', () => {
    const sentence = ['He will corroborate it.']
    expect(hintRungs(w('corroborate', ['证实'], sentence, 'cor-(加强) + robur(力量)'))).toHaveLength(1)
    expect(hintRungs(w('corroborate', ['证实'], sentence, '→ 证实'))).toHaveLength(1)
    expect(hintRungs(w('corroborate', ['证实'], sentence, '  → 加固 → 证实'))).toHaveLength(1)
    expect(hintRungs(w('corroborate', ['证实'], sentence, ''))).toHaveLength(1)
  })

  it("has no etymology rung when the text before the arrow already carries one of the word's own glosses", () => {
    // credence's etymology glosses its root with the word's own meaning, so the
    // part before the arrow is the answer too.
    const sentence = ['Nobody gave credence to the rumour.']
    expect(hintRungs(w('credence', ['相信;采信;可信度'], sentence, 'credere(相信) → 采信'))).toEqual([
      { kind: 'example', sentence: 'Nobody gave credence to the rumour.' },
    ])
    // Any of its meanings, not only the first: the card may have been missed on either.
    expect(hintRungs(w('solace', ['慰藉', '安慰'], ['She found solace in music.'], '拉丁 solari(安慰) → 慰藉'))).toHaveLength(1)
  })

  it('keeps the etymology rung when only a one-character gloss appears before the arrow', () => {
    // 力 and 强 are glosses here and both sit inside the text before the arrow,
    // but a one-character term is not counted.
    const word = w('x', ['力;强'], ['He will x it.'], CORROBORATE_ETYM)
    expect(hintRungs(word)).toContainEqual({ kind: 'etymology', text: 'cor-(加强) + robur(力量)' })
  })

  it('keeps an etymology rung when no example locates the headword', () => {
    const word = w('corroborate', ['证实'], ['Nothing here names the word.'], CORROBORATE_ETYM)
    expect(hintRungs(word)).toEqual([{ kind: 'etymology', text: 'cor-(加强) + robur(力量)' }])
  })

  it('is empty when there is neither', () => {
    expect(hintRungs(w('corroborate', ['证实'], ['Nope.']))).toEqual([])
  })

  it('finds an inflected headword the way the cloze does', () => {
    const word = w('corroborate', ['证实'], ['Her account was corroborated by two witnesses.'])
    expect(hintRungs(word)).toEqual([{ kind: 'example', sentence: 'Her account was corroborated by two witnesses.' }])
  })
})
