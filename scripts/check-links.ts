// scripts/check-links.ts
/**
 * Lists pairs of library words that read as synonyms in Chinese but are
 * joined by nothing in the contrast graph, and asks Jev whether each is a
 * pair a quiz would have to treat as interchangeable.
 *
 * check-synonyms looks for edges that should not exist; this looks for the
 * ones that should. A missing edge is not only a 辨析 pair never asked: the
 * contrast graph is what keeps a second right answer out of the options.
 * `generateAntonymQuestion` bans everything confusable with its answer, so
 * with `ravishing` and `captivating` unjoined, "the opposite of hideous"
 * could offer the one as a wrong option beside the other as the answer.
 *
 * The candidate test is a shared gloss term under the same part of
 * speech, CJK only, parentheticals dropped first — `（情绪等）` is a usage
 * label, not a meaning, and paired oscillate with percolate. Two
 * characters, because three misses the verbs and nouns: their glosses run
 * two characters (诡计, 贬低, 证实) where an adjective carries 的. Measured
 * 2026-10-13 over 1212 words: 155 candidates at three characters, and 72
 * more at two, every one a verb (44) or a noun (28).
 *
 * A candidate is not a verdict: observant shares 虔诚的 with pious through
 * its religious sense. Read one by one, 40 of the 155 and 15 of the 71
 * still open at two characters were interchangeable — a quarter and a
 * fifth; the rest shared a gloss and nothing a reader would mix up.
 * Verbs miss more often through a secondary sense (支持 joins affirm,
 * bolster and sympathize, three different kinds of support). Linking is
 * a synonym written into an entry, and a synonym joins every word that
 * lists it — write it on the side whose other listers belong with the new
 * partner, and diff the pair graph, 发散 membership and passage pools after.
 *
 * Jev orders the reading, it does not replace it, and it is weaker where
 * the shorter terms reach. Against labels made before it ran, at P >= 0.9:
 * on the three-character adjectives it flagged 31, 26 right (84%
 * precision, 65% recall; irritate/madden scored 0.12 on degree alone); on
 * the two-character verbs and nouns it flagged 7, 2 right, and the other
 * 5 were all words that meet only in a secondary sense (belittle/degrade
 * on 贬低). Reading its disagreements moved four labels across both
 * rounds: primal/primitive, assuage/gratify and appease/gratify in,
 * dubious/shifty out.
 *
 * Exit 0 with a report, 2 on a missing key or a failed call. Needs
 * TYPESAFE_API_KEY (environment or .env.local) unless --no-jev.
 *
 *   npx tsx scripts/check-links.ts                  every candidate, with Jev's reading
 *   npx tsx scripts/check-links.ts --ids a,b,c      candidates touching these words (a batch)
 *   npx tsx scripts/check-links.ts --min-term 3     longer terms only, mostly adjectives
 *   npx tsx scripts/check-links.ts --no-jev         candidates only, no key needed
 */
import { readFileSync } from 'node:fs'
import { buildAntonymPairs } from '../src/lib/antonym.ts'
import { buildContrastPairs } from '../src/lib/contrast.ts'
import type { Word, WordsFile } from '../src/types.ts'
import { MODEL, askJev, costOf, loadKey, mapPool } from './jev.ts'

/** Shortest shared gloss term that counts by default — see the header for what three characters missed. */
export const MIN_TERM = 2

/**
 * `pos\tterm` for every CJK-only term of at least `minTerm` characters in
 * the word's glosses. Keyed by part of speech so a noun gloss and an
 * adjective gloss that happen to share characters never meet.
 */
export function glossTerms(w: Word, minTerm = MIN_TERM): Set<string> {
  const out = new Set<string>()
  for (const m of w.meanings) {
    const bare = m.zh.replace(/[（(][^）)]*[）)]/g, ' ')
    for (const raw of bare.split(/[;；,，、/\s…]+/)) {
      const t = raw.trim()
      if (t.length >= minTerm && /^[一-鿿]+$/.test(t)) out.add(`${m.pos}\t${t}`)
    }
  }
  return out
}

export interface Candidate {
  /** Word id, the alphabetically earlier one */
  a: string
  b: string
  /** Shared gloss terms, `pos term`, sorted */
  terms: string[]
}

/** Same-POS pairs sharing a gloss term and joined in neither the contrast nor the antonym graph. */
export function missingLinks(words: Word[], ids?: Set<string>, minTerm = MIN_TERM): Candidate[] {
  const key = (x: string, y: string) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`)
  const joined = new Set([...buildContrastPairs(words), ...buildAntonymPairs(words)].map((p) => key(p.a, p.b)))

  const byTerm = new Map<string, string[]>()
  for (const w of words) {
    for (const t of glossTerms(w, minTerm)) byTerm.set(t, [...(byTerm.get(t) ?? []), w.id])
  }

  const acc = new Map<string, Candidate>()
  for (const [t, members] of byTerm) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const x = members[i], y = members[j]
        if (x === y || joined.has(key(x, y))) continue
        if (ids && !ids.has(x) && !ids.has(y)) continue
        const k = key(x, y)
        const [a, b] = x < y ? [x, y] : [y, x]
        const c = acc.get(k) ?? { a, b, terms: [] }
        c.terms.push(t.replace('\t', ' '))
        acc.set(k, c)
      }
    }
  }
  return [...acc.values()]
    .map((c) => ({ ...c, terms: [...new Set(c.terms)].sort() }))
    .sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b))
}

const senses = (w: Word) => w.meanings.map((m) => `(${m.pos}) ${m.en}`).join('; ')

export function requestBody(c: Candidate, byId: Map<string, Word>) {
  const A = byId.get(c.a)!, B = byId.get(c.b)!
  return {
    model: MODEL,
    state: `Word A: ${A.headword} — ${senses(A)}\nWord B: ${B.headword} — ${senses(B)}`,
    questions: {
      interchangeable: {
        type: 'choice' as const,
        instructions:
          'In at least one sense, could one of these words replace the other in a sentence without changing what it says — so that a quiz asking for one would have to accept the other as correct too?',
        criteria: {
          interchangeable: 'yes — in some sense they are synonyms and either word would be a correct answer',
          distinct: 'no — they are related at most, and a careful reader would pick only one of them',
        },
      },
    },
  }
}

/** P(interchangeable); NaN on a malformed answer, which sorts first so it is read rather than passed. */
export function judge(response: unknown): number {
  const p = (response as { answers?: Record<string, { probabilities?: Record<string, unknown> }> } | null)?.answers
    ?.interchangeable?.probabilities?.interchangeable
  return typeof p === 'number' ? p : NaN
}

async function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--ids')
  if (at !== -1 && !args[at + 1]) {
    console.error('--ids requires a comma-separated list of word ids')
    process.exit(2)
  }
  const ids = at === -1 ? undefined : new Set(args[at + 1].split(',').map((s) => s.trim()).filter(Boolean))
  const mt = args.indexOf('--min-term')
  const minTerm = mt === -1 ? MIN_TERM : Number(args[mt + 1])
  if (!Number.isInteger(minTerm) || minTerm < 1) {
    console.error('--min-term requires a positive integer')
    process.exit(2)
  }
  const useJev = !args.includes('--no-jev')
  const key = useJev ? loadKey() : undefined
  if (useJev && !key) {
    console.error('TYPESAFE_API_KEY is not set (environment or .env.local); --no-jev lists the candidates without it')
    process.exit(2)
  }

  const words = (JSON.parse(readFileSync('data/words.json', 'utf8')) as WordsFile).words
  const byId = new Map(words.map((w) => [w.id, w]))
  const cands = missingLinks(words, ids, minTerm)
  let scores: number[] = cands.map(() => NaN)
  let tokens = 0
  if (key) {
    try {
      scores = await mapPool(cands, 8, async (c) => {
        const r = await askJev(key, requestBody(c, byId))
        tokens += (r as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0
        return judge(r)
      })
    } catch (e) {
      console.error(`Jev request failed: ${(e as Error).message}`)
      process.exit(2)
    }
  }

  const order = cands.map((c, i) => ({ c, p: scores[i] }))
  if (key) order.sort((x, y) => (Number.isNaN(x.p) ? -1 : Number.isNaN(y.p) ? 1 : y.p - x.p))
  console.log(`check-links: ${cands.length} unjoined same-POS pairs sharing a gloss term of ${minTerm}+ characters` +
    (key ? ` (${tokens} input tokens, ${costOf(tokens)})` : ''))
  const gloss = (w: Word) => w.meanings.map((m) => `(${m.pos}) ${m.zh} | ${m.en}`).join(' / ')
  for (const { c, p } of order) {
    const A = byId.get(c.a)!, B = byId.get(c.b)!
    console.log(`\n${key ? `${Number.isNaN(p) ? ' ?? ' : p.toFixed(2)}  ` : ''}${c.a} ~ ${c.b}   [${c.terms.join(', ')}]`)
    console.log(`   ${c.a}: ${gloss(A)}\n      syn: ${A.synonyms.join(', ')}`)
    console.log(`   ${c.b}: ${gloss(B)}\n      syn: ${B.synonyms.join(', ')}`)
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('check-links.ts')) await main()
