/**
 * What a word batch adds to the passages' tier-1 distractor pools, with the
 * blank each new entry neighbours and that blank's sentence.
 *
 *   npx tsx scripts/passage-pool-diff.ts              against HEAD's data/words.json
 *   npx tsx scripts/passage-pool-diff.ts --base <ref> against another commit
 *
 * Run it after the batch is in data/words.json, before the commit. Read every
 * line and ask one question: **would this word, put in that blank, also be a
 * correct answer?** If yes, add it to that passage's `exclude`.
 *
 * Why it exists: tier 1 of pickDistractors is the non-direct (shared-synonym)
 * neighbours of a passage's blanks, so a passage's distractor pool is derived,
 * like a 发散 answer set, and a new word walks into it with nothing authored.
 * validate-passages prints the whole pool, which is unreadable as a diff. Measured
 * on the 2026-10-12 batch (125 words): 65 entries new to some passage's pool,
 * and **47 of them would have been a second right answer** — "a common {{snag}}"
 * for impediment, "an utterly {{uncontrollable}} force" for intractable, "began
 * to {{madden}} everyone" for exasperate. The other 18 could not fit their slot
 * (a noun offered for an adjective blank, "for time {{immemorial}}").
 *
 * An entry is printed once per passage, through the first blank that reaches it,
 * and only when no blank of that passage reached it before the batch — a word
 * already in a passage's pool was already read, or already offered.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { buildContrastPairs } from '../src/lib/contrast'
import type { PassagesFile } from '../src/lib/passage'
import type { Word, WordsFile } from '../src/types'

const args = process.argv.slice(2)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'HEAD'
if (base === undefined || base.startsWith('--')) {
  console.error('--base needs a git ref')
  process.exit(1)
}

const before = (JSON.parse(execFileSync('git', ['show', `${base}:data/words.json`], { encoding: 'utf8', maxBuffer: 64 << 20 })) as WordsFile).words
const after = (JSON.parse(readFileSync('data/words.json', 'utf8')) as WordsFile).words
const passages = (JSON.parse(readFileSync('src/data/passages.json', 'utf8')) as PassagesFile).passages

/** id → shared-synonym neighbours, with the synonyms joining them. Direct pairs are never offered, so they are left out. */
function neighbours(words: Word[]): Map<string, Map<string, string[]>> {
  const m = new Map<string, Map<string, string[]>>()
  for (const p of buildContrastPairs(words)) {
    if (p.direct) continue
    for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
      ;(m.get(x) ?? m.set(x, new Map()).get(x)!).set(y, p.shared)
    }
  }
  return m
}

const was = neighbours(before)
const now = neighbours(after)
const gloss = new Map(after.map(w => [w.id, w.meanings[0]?.zh ?? '']))

let n = 0
for (const p of passages) {
  // The first sentence each blank appears in, for context.
  const blanks = new Map<string, string>()
  for (const s of p.en) {
    for (const m of s.matchAll(/\{\{([^}|]+)(?:\|[^}]*)?\}\}/g)) {
      if (!blanks.has(m[1])) blanks.set(m[1], s)
    }
  }
  const excluded = new Set([...blanks.keys(), ...(p.exclude ?? [])])
  const printed = new Set<string>()
  for (const [blank, sentence] of blanks) {
    for (const [other, shared] of now.get(blank) ?? []) {
      if (excluded.has(other) || printed.has(other)) continue
      if ([...blanks.keys()].some(b => was.get(b)?.has(other))) continue
      printed.add(other)
      n++
      console.log(`[${p.id}] +${other} (${gloss.get(other)}) via ${blank} [${shared.join(', ')}]\n    ${sentence}`)
    }
  }
}

console.log(n === 0
  ? `no passage gained a tier-1 distractor against ${base}`
  : `\n${n} new tier-1 distractor(s) against ${base} — read each in its sentence; one that would also be correct goes in that passage's exclude`)
