// scripts/check-senses.ts
/**
 * Asks Jev which sense of its headword each 回想 rendering's English example
 * uses, and prints every rendering whose `sense` tag says otherwise.
 *
 * The tag picks the English hint (`hintFor`), so a wrong one points the
 * learner at a different meaning than the sentence is about. The 09-12 audit
 * tagged by character overlap and could not see part of speech; Jev, asked
 * over the 904 renderings on polysemous words on 2026-10-01, disagreed 59
 * times, and read by hand 37 of those were wrong tags (`harangued` on the
 * noun, `mimed` on 哑剧演员), 14 were Jev wrong and 8 read either way.
 *
 * Jev is a typed-judgment model (TypeSafe AI): it answers a choice question
 * with a probability and writes no prose. It reads English best, which is
 * why it is shown the English example and the English glosses only.
 *
 * Agreement is not proof. A second pass over the same 904 the same day
 * moved 7 of the doubtful band (5 in, 2 out) while the confident band held,
 * and one that moved in, `stoic#3`, was a wrong tag the first pass had
 * agreed with. Run it once per batch and read what it prints; re-running
 * to make a line go away proves nothing.
 *
 * A disagreement is advice, never an edit: the person reads it and decides.
 * Exit 0 with a report, 2 on a missing key or a failed API call. Needs
 * TYPESAFE_API_KEY (environment, or .env.local, which is gitignored), so it
 * never runs in CI.
 *
 *   npx tsx scripts/check-senses.ts                 every rendering on a polysemous word
 *   npx tsx scripts/check-senses.ts --ids a,b,c     only these words (a batch)
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Word, WordsFile } from '../src/types.ts'
import type { RecallSentence, RecallSentencesFile } from '../src/lib/recallSentence.ts'

/**
 * Pinned, not `jev-latest`: the threshold below was measured on this
 * version. Bump it and re-run the whole library against the tags first.
 */
export const MODEL = 'jev-1.13.0'

/**
 * A disagreement at or above this confidence was a wrong tag 33 times in 34
 * (2026-10-01); below it, 3 times in 25. It sorts the report — both kinds
 * are still read before anything changes.
 */
export const RETAG_CONFIDENCE = 0.9

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const CONCURRENCY = 8

export function readKey(envFile: string | undefined, fromEnv: string | undefined): string | undefined {
  if (fromEnv?.trim()) return fromEnv.trim()
  const line = envFile?.split(/\r?\n/).find((l) => l.startsWith('TYPESAFE_API_KEY='))
  const value = line?.slice('TYPESAFE_API_KEY='.length).trim().replace(/^(['"])(.*)\1$/, '$2')
  return value || undefined
}

export interface Item {
  key: string
  id: string
  i: number
  headword: string
  sentence: string
  meanings: Word['meanings']
  tag: number
}

/** Renderings on polysemous words. A missing word or example is skipped, never thrown on. */
export function buildItems(words: Word[], sentences: RecallSentence[], ids?: Set<string>): Item[] {
  const byId = new Map(words.map((w) => [w.id, w]))
  const items: Item[] = []
  for (const s of sentences) {
    if (ids && !ids.has(s.id)) continue
    const w = byId.get(s.id)
    const sentence = w?.examples[s.i]
    if (!w || w.meanings.length < 2 || typeof sentence !== 'string') continue
    items.push({ key: `${s.id}#${s.i}`, id: s.id, i: s.i, headword: w.headword, sentence, meanings: w.meanings, tag: s.sense ?? 0 })
  }
  return items
}

/**
 * One choice question over every sense. Measured against a yes/no "is this
 * the first sense?" question on the same 904: AUROC 0.970 against 0.946,
 * because the yes/no form could not separate a sense from its other part
 * of speech (`relapse` the noun from `relapse` the verb).
 */
export function requestBody(item: Item) {
  return {
    model: MODEL,
    state: item.sentence,
    questions: {
      sense: {
        type: 'choice' as const,
        instructions: `Which meaning of the word "${item.headword}" is used in this sentence?`,
        criteria: Object.fromEntries(item.meanings.map((m, k) => [`s${k}`, `(${m.pos}) ${m.en}`])),
      },
    },
  }
}

export interface Verdict {
  pick: number | null
  confidence: number
  verdict: 'agree' | 'retag' | 'read'
}

/** A malformed answer goes to be read: counting it as agreement would hide it. */
export function classify(tag: number, response: unknown): Verdict {
  const answer = (response as { answers?: { sense?: { choice?: unknown; confidence?: unknown } } } | null)?.answers?.sense
  const m = typeof answer?.choice === 'string' ? /^s(\d+)$/.exec(answer.choice) : null
  const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
  if (!m) return { pick: null, confidence, verdict: 'read' }
  const pick = Number(m[1])
  if (pick === tag) return { pick, confidence, verdict: 'agree' }
  return { pick, confidence, verdict: confidence >= RETAG_CONFIDENCE ? 'retag' : 'read' }
}

async function ask(key: string, item: Item, attempt = 0): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(item)),
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return ask(key, item, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function main() {
  const args = process.argv.slice(2)
  const idsAt = args.indexOf('--ids')
  if (idsAt !== -1 && !args[idsAt + 1]) {
    console.error('--ids requires a comma-separated list of word ids')
    process.exit(2)
  }
  const ids = idsAt === -1 ? undefined : new Set(args[idsAt + 1].split(',').map((s) => s.trim()).filter(Boolean))

  const key = readKey(existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : undefined, process.env.TYPESAFE_API_KEY)
  if (!key) {
    console.error('TYPESAFE_API_KEY is not set (environment or .env.local)')
    process.exit(2)
  }

  const words = (JSON.parse(readFileSync('data/words.json', 'utf8')) as WordsFile).words
  const sentences = (JSON.parse(readFileSync('src/data/recallSentences.json', 'utf8')) as RecallSentencesFile).sentences
  const items = buildItems(words, sentences, ids)
  if (ids) {
    const missing = [...ids].filter((id) => !items.some((it) => it.id === id))
    if (missing.length) console.log(`no rendering on a polysemous word, nothing to ask: ${missing.join(', ')}`)
  }

  const results: { item: Item; v: Verdict }[] = []
  const queue = [...items]
  let tokens = 0
  try {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const response = await ask(key, item)
          tokens += (response as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0
          results.push({ item, v: classify(item.tag, response) })
        }
      }),
    )
  } catch (e) {
    console.error(`Jev request failed after ${results.length} of ${items.length}: ${(e as Error).message}`)
    process.exit(2)
  }

  const show = ({ item, v }: { item: Item; v: Verdict }) => {
    const label = (k: number | null) => (k === null ? '(no answer)' : `s${k} ${item.meanings[k]?.en ?? '(out of range)'}`)
    return `  ${item.key}  confidence ${v.confidence.toFixed(2)}\n    ${item.sentence}\n    tagged ${label(item.tag)}\n    Jev    ${label(v.pick)}`
  }
  const byKey = (a: { item: Item }, b: { item: Item }) => a.item.key.localeCompare(b.item.key)
  const retag = results.filter((r) => r.v.verdict === 'retag').sort(byKey)
  const read = results.filter((r) => r.v.verdict === 'read').sort(byKey)

  console.log(`check-senses: ${results.length} renderings asked, ${retag.length + read.length} disagree (${tokens} input tokens, ~$${((tokens * 0.042) / 1e6).toFixed(4)})`)
  if (retag.length) {
    console.log(`\nconfident (>= ${RETAG_CONFIDENCE}) — usually a wrong tag; read, then fix the tag:`)
    retag.forEach((r) => console.log(show(r)))
  }
  if (read.length) {
    console.log(`\ndoubtful (< ${RETAG_CONFIDENCE}) — usually Jev wrong; read, change only what is clearly wrong:`)
    read.forEach((r) => console.log(show(r)))
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('check-senses.ts')) await main()
