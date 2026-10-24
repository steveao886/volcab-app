import type { Word } from '../types'
import type { SynonymGroup } from './synonymGroups'

/**
 * Each 近义词 group's opposite group, when it has a clear one (spec R3): the
 * group joined to it by the most opposite pairs, at least two and strictly
 * more than any other group. The user's observation was that an opposite is
 * just another synonym group; this finds which one.
 *
 * **An opposite pair is two first-meaning members, one listing the other in
 * `antonyms`.** An antonym hangs off a word, not a sense (CLAUDE.md, the
 * 发散 反面 axis: 9 of 31 opposite questions had a stray, all from words
 * carrying two senses), so a member that is in its group through a later
 * meaning would bring opposites of the sense the group is not about. Listed on
 * both sides, a pair still counts once.
 *
 * On data/words.json, 2026-10-23: 149 of the 519 groups have an opposite
 * group, 68 of them in pairs that pick each other — 朴素↔奢华, 减轻↔使恶化,
 * 审慎↔轻率. A single pair or a tie is too thin to call a group the opposite
 * of another, and the per-word 反义 line still shows the words. 4 ms on a
 * desktop over the whole library, so the page computes it on mount.
 *
 * Returns group key → opposite group key. Not necessarily symmetric: a group's
 * best can have a better match elsewhere.
 */
export function oppositeGroups(groups: SynonymGroup[], words: Word[]): Map<string, string> {
  // Symmetric: an antonym listed on either side joins the two words.
  const byHead = new Map(words.map((w) => [w.headword.trim().toLowerCase(), w.id]))
  const opposite = new Map<string, Set<string>>()
  const join = (a: string, b: string) => {
    let s = opposite.get(a)
    if (s === undefined) opposite.set(a, (s = new Set()))
    s.add(b)
  }
  for (const w of words) {
    for (const a of Array.isArray(w.antonyms) ? w.antonyms : []) {
      const id = typeof a === 'string' ? byHead.get(a.trim().toLowerCase()) : undefined
      if (id !== undefined && id !== w.id) { join(w.id, id); join(id, w.id) }
    }
  }

  // Which groups each word is a first-meaning member of.
  const firstIn = new Map<string, number[]>()
  groups.forEach((g, i) => {
    for (const m of g.members) {
      if (!m.firstMeaning) continue
      const list = firstIn.get(m.id)
      if (list) list.push(i)
      else firstIn.set(m.id, [i])
    }
  })

  const out = new Map<string, string>()
  groups.forEach((g, i) => {
    const pairs = new Map<number, Set<string>>()
    for (const m of g.members) {
      if (!m.firstMeaning) continue
      for (const other of opposite.get(m.id) ?? []) {
        for (const j of firstIn.get(other) ?? []) {
          if (j === i) continue
          let set = pairs.get(j)
          if (set === undefined) pairs.set(j, (set = new Set()))
          set.add([m.id, other].sort().join('|'))
        }
      }
    }
    const ranked = [...pairs.entries()].map(([j, s]) => [j, s.size] as const).sort((a, b) => b[1] - a[1])
    const [best, second] = ranked
    if (best !== undefined && best[1] >= 2 && (second === undefined || second[1] < best[1])) {
      out.set(g.key, groups[best[0]].key)
    }
  })
  return out
}
