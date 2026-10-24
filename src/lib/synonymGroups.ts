import type { Word } from '../types'
import { glossTerms } from './forget'

/**
 * The groups 近义词 shows: library words that share a Chinese gloss term
 * (docs/superpowers/specs/2026-10-23-synonym-groups-design.md §2 and R1).
 *
 * **Every library word, studied or not** (R1). Membership used to follow
 * progress, so a group changed whenever one of its words was studied, and 12
 * of 329 paragraphs went stale within hours of being written. Over the whole
 * library a group changes only when the library does, which is also what lets
 * the write-side gate require a paragraph for every group. 519 groups on the
 * live library, 2026-10-23 (1,411 words).
 */

/** One displayed word in a group. */
export interface SynonymMember {
  id: string
  /** Every meaning index whose gloss terms include one of the group's terms, ascending. */
  carrying: number[]
  /**
   * Whether meanings[0] is among `carrying`. Per-word content (collocations,
   * word notes, pair notes) describes a word by its first sense, so a word that
   * joins only through a later one shows none of it (spec §3).
   */
  firstMeaning: boolean
}

/**
 * The base word a lone member brings (spec R2): one of its own related forms,
 * in a part of speech another member has, so like is compared with like —
 * `diminish` (v.) beside `dwindle` (v.) where the group holds `diminishing`
 * (adj.).
 */
export interface SynonymBridge {
  /** The lone member it is shown under. */
  for: string
  form: string
  pos: string
  zh: string
  /** The library word whose headword is `form`, when there is one. */
  wordId?: string
}

export interface SynonymGroup {
  /** `terms` joined with 、 — the title, and the identity a visit holds on to. */
  key: string
  /** Sorted. More than one when identical member sets merged. */
  terms: string[]
  /** First-meaning members first, then the rest, each by headword. */
  members: SynonymMember[]
  /** At most one per lone member, in member order. */
  bridges: SynonymBridge[]
}

export function buildSynonymGroups(words: Word[]): SynonymGroup[] {
  const byId = new Map(words.map((w) => [w.id, w]))
  const byHead = new Map(words.map((w) => [w.headword.trim().toLowerCase(), w.id]))

  // 1. Term → word ids, over every meaning: stripping 的 is what puts 不安的
  // (adj.) and 不安 (n.) under one term, and later meanings are how 减轻 finds
  // `blunt`.
  const byTerm = new Map<string, Set<string>>()
  for (const w of words) {
    for (const m of w.meanings) {
      for (const t of glossTerms(m.zh)) {
        let set = byTerm.get(t)
        if (set === undefined) byTerm.set(t, (set = new Set()))
        set.add(w.id)
      }
    }
  }

  // 2–4. Two or more, not one word family, identical sets merged.
  const family = familyLinks(words)
  const bySet = new Map<string, { terms: string[]; ids: string[] }>()
  for (const [term, set] of byTerm) {
    if (set.size < 2) continue
    const ids = [...set].sort()
    if (oneFamily(ids, family)) continue
    const k = ids.join('\n')
    const hit = bySet.get(k)
    if (hit) hit.terms.push(term)
    else bySet.set(k, { terms: [term], ids })
  }

  // 5. A strict subset of another group's members is met in the larger group.
  const candidates = [...bySet.values()]
  const sets = candidates.map((c) => new Set(c.ids))
  const kept = candidates.filter((c, i) =>
    !sets.some((s, j) => j !== i && s.size > c.ids.length && c.ids.every((id) => s.has(id))))

  return kept.map((c) => {
    const terms = [...c.terms].sort()
    const members = c.ids.flatMap((id): SynonymMember[] => {
      const w = byId.get(id)
      if (w === undefined) return []
      const carrying = w.meanings.flatMap((m, i) => (glossTerms(m.zh).some((t) => terms.includes(t)) ? [i] : []))
      return [{ id, carrying, firstMeaning: carrying.includes(0) }]
    })
    members.sort((a, b) =>
      a.firstMeaning !== b.firstMeaning
        ? (a.firstMeaning ? -1 : 1)
        : (byId.get(a.id)?.headword ?? a.id).localeCompare(byId.get(b.id)?.headword ?? b.id))
    return { key: terms.join('、'), terms, members, bridges: bridgesFor(members, byId, byHead) }
  })
}

/**
 * A member is lone when none of its carrying meanings shares a part of speech
 * with any carrying meaning of another member — every carrying meaning, so a
 * member that holds the term as a verb and as a noun pairs with either. It
 * brings the first of its related forms whose part of speech another member
 * has and whose form is not already a member. Lone members are taken in
 * member order, and a part of speech an earlier base word brought counts as
 * present. On data/words.json, 2026-10-23
 * (519 groups): 213 mix parts of speech and 115 bring a base word, 123 in
 * all, 40 of them library words. The rest leave the part-of-speech
 * difference to the paragraph.
 */
function bridgesFor(members: SynonymMember[], byId: Map<string, Word>, byHead: Map<string, string>): SynonymBridge[] {
  const posOf = (m: SynonymMember) => new Set(m.carrying.flatMap((i) => {
    const meaning = byId.get(m.id)?.meanings[i]
    return meaning === undefined ? [] : [meaning.pos]
  }))
  const heads = new Set(members.map((m) => byId.get(m.id)?.headword.trim().toLowerCase()))
  const out: SynonymBridge[] = []
  for (const m of members) {
    const mine = posOf(m)
    const others = new Set(members.filter((n) => n !== m).flatMap((n) => [...posOf(n)]))
    // A part of speech a base word already brought counts as present: once
    // diminish (v.) stands beside dwindle, dwindle has its pair, and a group of
    // two lone members brings one base word, not one each.
    if ([...mine].some((p) => others.has(p) || out.some((b) => b.pos === p))) continue
    const forms = byId.get(m.id)?.relatedForms
    const r = (Array.isArray(forms) ? forms : []).find((f) =>
      typeof f?.form === 'string' && others.has(f.pos) && !heads.has(f.form.trim().toLowerCase()))
    if (r === undefined) continue
    const wordId = byHead.get(r.form.trim().toLowerCase())
    out.push({ for: m.id, form: r.form, pos: r.pos, zh: r.zh, ...(wordId === undefined ? {} : { wordId }) })
  }
  return out
}

/** Undirected `relatedForms` edges between library words, matched by headword. */
function familyLinks(words: Word[]): Map<string, Set<string>> {
  const byHead = new Map(words.map((w) => [w.headword.trim().toLowerCase(), w.id]))
  const links = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let s = links.get(a)
    if (s === undefined) links.set(a, (s = new Set()))
    s.add(b)
  }
  for (const w of words) {
    for (const r of Array.isArray(w.relatedForms) ? w.relatedForms : []) {
      const other = typeof r?.form === 'string' ? byHead.get(r.form.trim().toLowerCase()) : undefined
      if (other !== undefined && other !== w.id) { link(w.id, other); link(other, w.id) }
    }
  }
  return links
}

/**
 * Whether every id is reachable from the first through family links: then the
 * whole difference is the part of speech (promulgate / promulgation), and
 * there is nothing to tell apart.
 */
function oneFamily(ids: string[], links: Map<string, Set<string>>): boolean {
  const seen = new Set([ids[0]])
  const stack = [ids[0]]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    for (const next of links.get(cur) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next) }
    }
  }
  return ids.every((id) => seen.has(id))
}
