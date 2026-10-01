// scripts/check-synonyms.ts
/**
 * Asks Jev, for every contrast pair joined only through a shared synonym,
 * whether that synonym means the same thing on both words, and prints the
 * suspicious ones grouped by the synonym that joins them.
 *
 * A synonym joins every word that lists it: the pair graph and 发散
 * membership are both built from shared synonym strings. A homograph —
 * `still` on `that-said` (nevertheless) and on `motionless` — therefore
 * manufactures a pair of unrelated words and walks words into answer sets
 * they do not belong in. The fix is to cut the synonym from the entry
 * where it means something else; this script only finds candidates.
 *
 * Calibrated 2026-10-01 on 119 hand-labelled pairs, 43 of them homograph
 * (the cuts made while adding 116 words): a flag on either question below
 * caught 18 of the 43 at 86% precision. It finds the pure noise and
 * misses pairs whose words are close anyway (unmoved/tepid). Run over the
 * 716 older pairs it flagged 177; read by hub, 58 cuts came of them.
 *
 * Read each hub before cutting: some 发散 concepts are built on a single
 * synonym (`equivalent` holds `commensurate` in its own concept), so check
 * `npx tsx scripts/content-staleness.ts --concepts` before and after.
 *
 * Exit 0 with a report, 2 on a missing key or a failed call. Needs
 * TYPESAFE_API_KEY (environment or .env.local), so it never runs in CI.
 *
 *   npx tsx scripts/check-synonyms.ts                 every shared-synonym pair
 *   npx tsx scripts/check-synonyms.ts --ids a,b,c     pairs touching these words (a batch)
 */
import { readFileSync } from 'node:fs'
import { buildContrastPairs } from '../src/lib/contrast.ts'
import type { Word, WordsFile } from '../src/types.ts'
import { MODEL, askJev, costOf, loadKey, mapPool } from './jev.ts'

/** P(the synonym reads two ways) at or above this flags the pair: 13 of 14 flagged were homographs. */
export const DIFFERENT = 0.9
/** P(the two words are unrelated) at or above this flags the pair: 14 of 16 flagged were homographs. */
export const UNRELATED = 0.3

export interface SharedPair { a: string; b: string; shared: string[] }

/** Pairs with no direct link — the ones a homograph synonym can manufacture. */
export function sharedOnlyPairs(words: Word[], ids?: Set<string>): SharedPair[] {
  return buildContrastPairs(words)
    .filter((p) => !p.direct && p.shared.length > 0 && (!ids || ids.has(p.a) || ids.has(p.b)))
    .map((p) => ({ a: p.a, b: p.b, shared: p.shared }))
}

const senses = (w: Word) => w.meanings.map((m) => `(${m.pos}) ${m.en}`).join('; ')

export function requestBody(pair: SharedPair, byId: Map<string, Word>) {
  const A = byId.get(pair.a)!, B = byId.get(pair.b)!
  const s = pair.shared.join("', '")
  return {
    model: MODEL,
    state: `Word A: ${A.headword} — ${senses(A)}\nWord B: ${B.headword} — ${senses(B)}\nBoth list '${s}' as a synonym.`,
    questions: {
      same_sense: {
        type: 'choice' as const,
        instructions: `Is '${s}' used in the same sense as a synonym of word A as it is as a synonym of word B?`,
        criteria: {
          same: `yes — '${s}' means the same thing for both words`,
          different: `no — '${s}' has two different meanings here, one fitting A and another fitting B`,
        },
      },
      confusable: {
        type: 'choice' as const,
        instructions: 'Are word A and word B close enough in meaning that a learner could mix them up in a sentence?',
        criteria: { close: 'yes — they overlap in meaning and could be confused', unrelated: 'no — they mean clearly different things' },
      },
    },
  }
}

export interface Judgement { different: number; unrelated: number; flagged: boolean }

/** A malformed answer is flagged: passing it silently would hide a pair nobody read. */
export function judge(response: unknown): Judgement {
  const a = (response as { answers?: Record<string, { probabilities?: Record<string, unknown> }> } | null)?.answers
  const d = a?.same_sense?.probabilities?.different, u = a?.confusable?.probabilities?.unrelated
  if (typeof d !== 'number' || typeof u !== 'number') return { different: NaN, unrelated: NaN, flagged: true }
  return { different: d, unrelated: u, flagged: d >= DIFFERENT || u >= UNRELATED }
}

export interface Hub { synonym: string; pairs: SharedPair[]; carriers: string[] }

/** One hub per shared synonym, biggest first — the cut is decided per synonym, not per pair. */
export function groupByHub(flagged: SharedPair[], words: Word[]): Hub[] {
  const hubs = new Map<string, SharedPair[]>()
  for (const p of flagged) for (const s of p.shared) hubs.set(s, [...(hubs.get(s) ?? []), p])
  return [...hubs.entries()]
    .map(([synonym, pairs]) => ({
      synonym,
      pairs,
      carriers: words.filter((w) => w.synonyms.some((x) => x.trim().toLowerCase() === synonym)).map((w) => w.id).sort(),
    }))
    .sort((x, y) => y.pairs.length - x.pairs.length || x.synonym.localeCompare(y.synonym))
}

async function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--ids')
  if (at !== -1 && !args[at + 1]) {
    console.error('--ids requires a comma-separated list of word ids')
    process.exit(2)
  }
  const ids = at === -1 ? undefined : new Set(args[at + 1].split(',').map((s) => s.trim()).filter(Boolean))
  const key = loadKey()
  if (!key) {
    console.error('TYPESAFE_API_KEY is not set (environment or .env.local)')
    process.exit(2)
  }

  const words = (JSON.parse(readFileSync('data/words.json', 'utf8')) as WordsFile).words
  const byId = new Map(words.map((w) => [w.id, w]))
  const pairs = sharedOnlyPairs(words, ids)
  let tokens = 0
  let judged: Judgement[]
  try {
    judged = await mapPool(pairs, 8, async (p) => {
      const r = await askJev(key, requestBody(p, byId))
      tokens += (r as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0
      return judge(r)
    })
  } catch (e) {
    console.error(`Jev request failed: ${(e as Error).message}`)
    process.exit(2)
  }

  const flagged = pairs.filter((_, i) => judged[i].flagged)
  const score = new Map(pairs.map((p, i) => [`${p.a}|${p.b}`, judged[i]]))
  const hubs = groupByHub(flagged, words)
  console.log(`check-synonyms: ${pairs.length} shared-synonym pairs asked, ${flagged.length} flagged in ${hubs.length} hubs (${tokens} input tokens, ${costOf(tokens)})`)
  if (!hubs.length) return
  console.log(`\nflagged at different >= ${DIFFERENT} or unrelated >= ${UNRELATED} — 86% were homographs. Cut the synonym from the entry where it means something else; leave pairs that are close anyway.`)
  for (const h of hubs) {
    console.log(`\n## ${h.synonym}  (${h.pairs.length} flagged; listed by ${h.carriers.length})`)
    for (const id of h.carriers) {
      const w = byId.get(id)!
      console.log(`   ${id}: ${w.meanings.map((m) => `(${m.pos}) ${m.en} | ${m.zh}`).join(' / ')}`)
    }
    console.log(`   flagged: ${h.pairs.map((p) => { const j = score.get(`${p.a}|${p.b}`)!; return `${p.a}|${p.b} (${j.different.toFixed(2)}/${j.unrelated.toFixed(2)})` }).join('  ')}`)
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('check-synonyms.ts')) await main()
