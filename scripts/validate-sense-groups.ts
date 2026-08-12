import { readFileSync } from 'node:fs'
import { isInflectionOf, splitByHeadword } from '../src/lib/headword.ts'

/**
 * Whether the sentence genuinely contains the word.
 *
 * splitByHeadword alone is not enough: for a word whose base form is
 * absent it falls back to a 3-4 letter stem, and that stem collides. The
 * first run of this check reported that `reprimand` contained `reprove`,
 * because `repr` matches both. Confirming each span with isInflectionOf —
 * which deliberately does not use that fallback — is the same pairing the
 * full-library regression in headword.test.ts settled on.
 */
const contains = (sentence: string, headword: string): boolean =>
  splitByHeadword(sentence, headword).some(seg => seg.hit && isInflectionOf(seg.text, headword))

/**
 * Gate for src/data/senseGroups.json — bundled content, so a bad entry
 * ships and stays until the next release; strict here, lenient at runtime,
 * the same split as the other five validators.
 *
 * The one rule with no counterpart elsewhere: **the prompt may contain no
 * Latin letters at all.** Every other authored file shows its text next to
 * the word it belongs to; a sense-group prompt is on screen *before* the
 * options exist, while the user is retrieving — a single English fragment
 * is the answer walking in early. Stricter than /guess's masking because
 * there is nothing to mask: the prompt is authored, so it can simply be
 * clean.
 */

const file = process.argv[2] ?? 'src/data/senseGroups.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string
  headword: string
  meanings: { pos: string }[]
}[]
const posOf = new Map(words.map(w => [w.id, w.meanings[0]?.pos ?? '']))
const senseCountOf = new Map(words.map(w => [w.id, w.meanings.length]))
const headwordOf = new Map(words.map(w => [w.id, w.headword]))
const libraryHeadwords = new Set(words.map(w => w.headword.toLowerCase()))
const errors: string[] = []

/**
 * Longer than a gloss, shorter than a passage sentence: the prompt sits
 * alone on the card at 375px and must be readable in one glance. The 59
 * groups in the initial batch measure 14–29 characters; 40 leaves headroom
 * without letting a paragraph in.
 */
const MAX_ZH = 40

/**
 * The English reveal is a sentence, not a paragraph — it sits under the
 * answer on a 375px card, above the why. The 59 in the first batch measure
 * 48–107 characters; 160 leaves room without admitting an essay.
 */
const MAX_EN = 160

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.groups)) {
  console.error('groups must be an array')
  process.exit(1)
}

const seenZh = new Set<string>()
const seenSet = new Set<string>()

data.groups.forEach((g: unknown, i: number) => {
  const at = `groups[${i}]`
  if (typeof g !== 'object' || g === null) { errors.push(`${at}: not an object`); return }
  const { zh, target, en, order, extra, sense, why } = g as {
    zh?: unknown; target?: unknown; en?: unknown; order?: unknown; extra?: unknown; sense?: unknown; why?: unknown
  }

  if (typeof zh !== 'string' || zh.trim() === '') { errors.push(`${at}: zh must be a non-empty string`); return }
  if (zh.length > MAX_ZH) errors.push(`${at} (${zh.slice(0, 10)}…): zh is ${zh.length} chars (max ${MAX_ZH})`)
  if (!/[一-鿿]/.test(zh)) errors.push(`${at}: zh must be Chinese — it is the question`)
  // The leak rule. [a-zA-Z] rather than a headword lookup, deliberately:
  // an inflection, a fragment, or a *different* English word all prime the
  // answer's shape. Zero Latin is the only version that needs no judgment.
  if (/[a-zA-Z]/.test(zh)) errors.push(`${at} (${zh.slice(0, 10)}…): zh contains Latin letters — the prompt shows before the options, this leaks`)

  if (seenZh.has(zh)) errors.push(`${at}: duplicate zh — it doubles as the rotation key, so a repeat makes two groups one`)
  seenZh.add(zh)

  // The target is which chunk of the scenario the learner is asked to
  // produce. Without it the question is unanswerable — a sentence carries
  // half a dozen content words and nothing said which one was wanted
  // (user-reported on the first day the mode shipped). Must locate exactly
  // once: zero means the highlight can't render, twice means it points at
  // two places.
  if (typeof target !== 'string' || target.trim() === '') {
    errors.push(`${at}: target must be a non-empty string — the prompt needs to say which part to express`)
  } else {
    if (/[a-zA-Z]/.test(target)) errors.push(`${at}: target contains Latin letters`)
    if (target.length > 16) errors.push(`${at}: target is ${target.length} chars (max 16) — it is an emphasis, not a second sentence`)
    if (typeof zh === 'string') {
      const n = zh.split(target).length - 1
      if (n !== 1) errors.push(`${at}: target "${target}" appears ${n}x in zh — must appear exactly once`)
    }
  }

  if (!Array.isArray(order) || order.some(id => typeof id !== 'string')) {
    errors.push(`${at}: order must be an array of word ids`); return
  }
  if (order.length < 1 || order.length > 4) errors.push(`${at}: ${order.length} members (must be 1–4)`)
  if (new Set(order).size !== order.length) errors.push(`${at}: duplicate ids in order`)
  for (const id of order) {
    if (!posOf.has(id)) errors.push(`${at}: ${id} not in the vocabulary — this group can never render`)
  }
  // Same POS only: two words with different parts of speech never compete
  // inside one sentence, so ranking them is not a judgment the mode tests.
  const poses = new Set(order.map(id => posOf.get(id)).filter(p => p !== undefined))
  if (poses.size > 1) errors.push(`${at}: mixed POS ${[...poses].join('/')} — members must compete in the same slot`)

  // Which sense of the answer the scenario is about, driving the English
  // hint shown after 想不起来. Dangling here is the same class of fault as a
  // note keyed to a word that does not exist: the read side falls back to
  // sense 0 and renders something plausible, so nothing downstream will ever
  // report that this group is pointing at a sense its answer does not have.
  if (sense !== undefined) {
    const n = senseCountOf.get(order[0] as string)
    if (!Number.isInteger(sense) || (sense as number) < 0) {
      errors.push(`${at}: sense must be a non-negative integer, got ${JSON.stringify(sense)}`)
    } else if (n !== undefined && (sense as number) >= n) {
      errors.push(`${at}: sense ${sense} but ${headwordOf.get(order[0] as string)} has ${n} meaning(s) — the hint would silently fall back to sense 0`)
    }
  }

  // Outside distractors: confusable words the library does not carry. They
  // exist because requiring every member to be a library word capped the
  // mode at 59 groups while 380 words had no library-internal partner at
  // all.
  let extraList: string[] = []
  if (extra !== undefined) {
    if (!Array.isArray(extra) || extra.some(x => typeof x !== 'string' || x.trim() === '')) {
      errors.push(`${at}: extra must be an array of non-empty headwords`)
    } else {
      extraList = extra as string[]
      for (const x of extraList) {
        // A library word listed here would be offered as a plain wrong
        // answer when it is in fact rankable, and tapping it would mark
        // nothing — the group is claiming the word is out of scope while
        // the library says otherwise. Put it in `order` instead.
        if (libraryHeadwords.has(x.toLowerCase())) {
          errors.push(`${at}: extra "${x}" is a library word — it belongs in order, where it can be ranked and marked`)
        }
        if (/[一-鿿]/.test(x)) errors.push(`${at}: extra "${x}" is not English`)
      }
      if (new Set(extraList.map(x => x.toLowerCase())).size !== extraList.length) {
        errors.push(`${at}: duplicate entries in extra`)
      }
      const overlap = extraList.filter(x => order.some(id => headwordOf.get(id)?.toLowerCase() === x.toLowerCase()))
      if (overlap.length > 0) errors.push(`${at}: extra repeats a member (${overlap.join(', ')})`)
    }
  }

  // Four options are shown; fillers are random same-POS words and test
  // nothing. Requiring three authored ones means at most one slot is
  // scenery.
  if (order.length + extraList.length < 3) {
    errors.push(`${at}: only ${order.length + extraList.length} authored option(s) — needs 3, or three of the four shown are random fillers`)
  }

  const key = [...order].sort().join('|')
  if (seenSet.has(key)) errors.push(`${at}: same member set as an earlier group — one trio, one scenario each; merge or differentiate`)
  seenSet.add(key)

  if (typeof why !== 'string' || why.trim() === '') errors.push(`${at}: why must be a non-empty string — the answer without the why is just an assertion`)
  else if (!/[一-鿿]/.test(why)) errors.push(`${at}: why must be Chinese — it is study content`)

  // The English reveal. Unlike zh this one is *allowed* to name the answer
  // — that is the whole point of it — but it is only ever rendered after
  // the question is graded, so the leak rule does not apply here.
  if (typeof en !== 'string' || en.trim() === '') {
    errors.push(`${at}: en must be a non-empty string — the reveal names the word and must also show it working`)
  } else {
    if (en.length > MAX_EN) errors.push(`${at}: en is ${en.length} chars (max ${MAX_EN})`)
    if (/[一-鿿]/.test(en)) errors.push(`${at}: en contains Chinese — it is the English rendering of zh, not a gloss`)
    if (Array.isArray(order) && order.length > 0) {
      // Must actually contain the answer, in the form the app can locate —
      // the same matcher the review card highlights with, so "mired" counts
      // for `mire` and a merely cognate form does not. A sentence that
      // doesn't contain the word teaches nothing the why hasn't said.
      const answer = headwordOf.get(order[0] as string)
      if (answer !== undefined && !contains(en, answer)) {
        errors.push(`${at}: en does not contain "${answer}" — the reveal has to show the answer doing the job`)
      }
      // And must not contain the losing members. The 排序 question asks the
      // learner to rank them; a sentence handing one of them over next to
      // the winner is the answer key printed on the card.
      for (const id of (order as string[]).slice(1)) {
        const other = headwordOf.get(id)
        if (other !== undefined && contains(en, other)) {
          errors.push(`${at}: en also contains "${other}", another member — that gives the ranking away`)
        }
      }
      for (const x of extraList) {
        if (contains(en, x)) errors.push(`${at}: en also contains "${x}", a distractor — the reveal must not endorse a wrong option`)
      }
    }
  }
})

if (errors.length > 0) {
  console.error(`senseGroups: ${errors.length} error(s)`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}

// Coverage is reported, not enforced, like the other content validators:
// the library moves, and a candidate trio without a group degrades to
// "not asked", which is the correct failure.
const covered = new Set(data.groups.flatMap((g: { order: string[] }) => g.order))
console.log(`senseGroups: ${data.groups.length} groups OK, covering ${covered.size} words`)

// The long-tail target report. Reported, never enforced: a target is the
// answer word's Chinese rendering, and how long that is depends on the word
// — `atomic` genuinely needs 要么都成功，要么都不生效 (12), while `alleviate`
// needs 减轻 (2). No length rule can tell the two apart, so this prints the
// tail and asks a human to read it.
//
// The threshold is p95 of the 312 groups that set the convention (mean 3.1,
// p50 3, p95 5), so a normal corpus shows a handful of entries here. A batch
// that shipped at mean 6.1 — clauses marked instead of words, caught by the
// user on the first question they saw — would have put 20+ lines on screen.
const LONG_TARGET = 5
const long = data.groups
  .map((g: { target?: string; order: string[] }, i: number) => ({ g, i }))
  .filter(({ g }: { g: { target?: string } }) => (g.target?.length ?? 0) > LONG_TARGET)
if (long.length > 0) {
  console.log(`\n${long.length} target(s) longer than ${LONG_TARGET} characters — check each marks only what its answer word says, not the clause around it:`)
  for (const { g, i } of long) console.log(`  [${i}] ${g.order[0]}: ${g.target}`)
}
