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

export interface SynonymGroup {
  /** `terms` joined with 、 — the title, and the identity a visit holds on to. */
  key: string
  /** Sorted. More than one when identical member sets merged. */
  terms: string[]
  /** First-meaning members first, then the rest, each by headword. */
  members: SynonymMember[]
}

export function buildSynonymGroups(words: Word[]): SynonymGroup[] {
  const byId = new Map(words.map((w) => [w.id, w]))

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
    return { key: terms.join('、'), terms, members }
  })
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
